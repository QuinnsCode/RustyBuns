// The campaign's Durable Object behind the Worker, hosted in-process by Rusty Buns with the same
// SQLite storage shape Cloudflare gives it.
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { durableObject, installCloudflareGlobals, sqlStorage } from "@rustybuns/shell-bun";
import worker, { CampaignRoom } from "../src/edge/worker.ts";
import { STARTS_PER_MINUTE, allowStart } from "../src/edge/limits.ts";
import type { View } from "../src/edge/campaign.ts";
import type { TurnRecord } from "../src/war/table.ts";

installCloudflareGlobals(); // WebSocketPair, and a Response that carries a socket
const env: any = { ASSETS: { fetch: async () => new Response("the page") } };
env.CAMPAIGN = durableObject(CampaignRoom as never, env);

const call = (path: string, token?: string, body?: unknown) => worker.fetch(new Request(`https://two-fronts.test${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: token ? { Authorization: `Bearer ${token}` } : {},
  body: body === undefined ? undefined : JSON.stringify(body),
}), env);

async function start(seats: object) {
  const res = await call("/api/campaigns", undefined, { seats });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; tokens: Record<string, string> };
}

test("an async game: each side hands in orders from its own link, and the turn resolves when both are in", async () => {
  const { id, tokens } = await start({ marines: "human", wooka: "human" });
  expect(Object.keys(tokens).sort()).toEqual(["marines", "wooka"]);

  const marines = (await (await call(`/api/campaigns/${id}`, tokens.marines)).json()) as View;
  expect(marines).toMatchObject({ seat: "marines", waiting: ["marines", "wooka"], handedIn: false });
  expect(marines.campaign.turn).toBe(1);

  const build = { faction: "wooka", orders: [{ kind: "build", unit: "army", at: { system: "nyx", sector: 0 } }] };
  const afterWooka = (await (await call(`/api/campaigns/${id}/orders`, tokens.wooka, build)).json()) as View;
  expect(afterWooka).toMatchObject({ seat: "wooka", waiting: ["marines"], handedIn: true });
  // The Marines see that the Wooka are in, but not what they ordered.
  const peek = await (await call(`/api/campaigns/${id}`, tokens.marines)).text();
  expect(peek).not.toContain('"build"');
  // Nor how many Wooka hold Nyx: no Marine is there to count them.
  expect(JSON.parse(peek).campaign.systems.nyx).toMatchObject({ fog: true, sectors: [{ owner: "wooka", armies: { wooka: 0 } }] });
  const own = (await (await call(`/api/campaigns/${id}`, tokens.wooka)).json()) as View;
  expect(own.campaign.systems.nyx!.sectors[0]!.armies.wooka).toBe(2);

  const resolved = (await (await call(`/api/campaigns/${id}/orders`, tokens.marines, { faction: "marines", orders: [] })).json()) as View;
  expect(resolved.campaign.turn).toBe(2);
  expect(resolved.waiting).toEqual(["marines", "wooka"]);
  expect((await (await call(`/api/campaigns/${id}`, tokens.wooka)).json() as View).campaign.systems.nyx!.sectors[0]!.armies.wooka).toBe(3);

  const history = (await (await call(`/api/campaigns/${id}/history`, tokens.wooka)).json()) as TurnRecord[];
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ turn: 1, battle: null, orders: [{ faction: "marines", orders: [] }, build] });
});

test("a seat can only speak for itself, and only with its own link", async () => {
  const { id, tokens } = await start({ marines: "human", wooka: "human" });
  expect((await call(`/api/campaigns/${id}`)).status).toBe(403);
  expect((await call(`/api/campaigns/${id}`, "x".repeat(32))).status).toBe(403);
  const wrongSide = await call(`/api/campaigns/${id}/orders`, tokens.wooka, { faction: "marines", orders: [] });
  expect(wrongSide.status).toBe(409);
  expect(await wrongSide.json()).toEqual({ error: "Those aren't orders" });
  const twice = async () => (await call(`/api/campaigns/${id}/orders`, tokens.marines, { faction: "marines", orders: [] })).status;
  expect(await twice()).toBe(200);
  expect(await twice()).toBe(409);
  // Another campaign's token is no good here.
  const other = await start({ marines: "human", wooka: "ai" });
  expect((await call(`/api/campaigns/${id}`, other.tokens.marines)).status).toBe(403);
});

test("against the AI online, there's one seat and every turn resolves at once", async () => {
  const { id, tokens } = await start({ marines: "ai", wooka: "human" });
  expect(Object.keys(tokens)).toEqual(["wooka"]);
  let v = (await (await call(`/api/campaigns/${id}/orders`, tokens.wooka, { faction: "wooka", orders: [] })).json()) as View;
  // The AI attacks on its first turn: the Wooka hold their ground, and the turn resolves.
  if (v.campaign.attacks) v = (await (await call(`/api/campaigns/${id}/orders`, tokens.wooka, { faction: "wooka", orders: [], retreats: [] })).json()) as View;
  expect(v.campaign.turn).toBe(2);
});

test("campaigns that were never started, bad ids and bad seats", async () => {
  expect((await call(`/api/campaigns/${"a".repeat(64)}`, "x".repeat(32))).status).toBe(404);
  expect((await call("/api/campaigns/not-an-id")).status).toBe(404);
  expect((await call("/api/campaigns", undefined, { seats: { marines: "ai", wooka: "ai" } })).status).toBe(400);
  expect((await call("/api/campaigns", undefined, { seats: { marines: "robot" } })).status).toBe(400);
  expect((await call("/api/campaigns", undefined, { seats: { marines: "human", wooka: "ai" }, galaxy: "nowhere" })).status).toBe(400);
  const full = await (await call("/api/campaigns", undefined, { seats: { marines: "human", wooka: "ai" }, galaxy: "full" })).json() as { id: string; tokens: Record<string, string> };
  const v = (await (await call(`/api/campaigns/${full.id}`, full.tokens.marines)).json()) as View;
  expect(v.campaign.galaxy).toBe("full");
  expect(Object.keys(v.campaign.systems)).toHaveLength(30);
  expect(await (await call("/")).text()).toBe("the page");
});

test("an address can start only so many campaigns a minute", () => {
  for (let i = 0; i < STARTS_PER_MINUTE; i++) expect(allowStart("1.2.3.4", 1000 + i)).toBe(true);
  expect(allowStart("1.2.3.4", 2000)).toBe(false);
  expect(allowStart("5.6.7.8", 2000)).toBe(true);
  expect(allowStart("1.2.3.4", 62_000)).toBe(true);
});

// A pointer socket opened through the Worker: what the object sends it, and a way to send it a frame.
async function pointerSocket(id: string, token?: string) {
  const res = await worker.fetch(new Request(`https://two-fronts.test/api/campaigns/${id}/pointers`, { headers: { Upgrade: "websocket" } }), env);
  expect(res.status).toBe(101);
  const client = (res as any).webSocket, got: any[] = [];
  client.toBrowser = (d: string) => got.push(JSON.parse(d));
  let closed: number | null = null;
  client.closeBrowser = (code: number) => (closed = code);
  const send = async (m: object) => { client.onMessage(JSON.stringify(m)); await Bun.sleep(5); };
  if (token) await send({ t: "hello", token });
  return { got, send, closed: () => closed };
}

test("the vote's pointers: each seat says hello with its token, and its pointer goes to the other seat", async () => {
  const { id, tokens } = await start({ marines: "human", wooka: "human" });
  const marines = await pointerSocket(id, tokens.marines), wooka = await pointerSocket(id, tokens.wooka);
  expect(marines.got).toEqual([{ t: "hi", seat: "marines" }]);
  await marines.send({ t: "at", x: 0.25, y: 2 });
  expect(wooka.got.at(-1)).toEqual({ t: "at", seat: "marines", x: 0.25, y: 1 });
  expect(marines.got).toHaveLength(1); // not back to itself
  // A socket that hasn't said hello hears nothing, and one with a bad token is shut.
  const stranger = await pointerSocket(id);
  await wooka.send({ t: "at", x: 0.5, y: 0.5 });
  expect(stranger.got).toEqual([]);
  expect(marines.got.at(-1)).toEqual({ t: "at", seat: "wooka", x: 0.5, y: 0.5 });
  await stranger.send({ t: "hello", token: "x".repeat(32) });
  expect(stranger.closed()).toBe(4003);
  // Not a socket: turned away.
  expect((await call(`/api/campaigns/${id}/pointers`, tokens.marines)).status).toBe(426);
});

test("the vote online: each seat POSTs one vote, the other screen hears it at once, and the last picks the mode", async () => {
  // The object on its own, so the test can open a vote without fighting a battle first.
  const sockets: any[] = [];
  const ctx = { storage: { sql: sqlStorage(() => new Database(":memory:")) }, acceptWebSocket: (ws: any) => sockets.push(ws), getWebSockets: () => sockets };
  const room = new CampaignRoom(ctx as never, {});
  const req = (path: string, token?: string, body?: unknown) => room.fetch(new Request(`https://campaign${path}`, {
    method: body === undefined ? "GET" : "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const { tokens } = (await (await req("/create", undefined, { seats: { marines: "human", wooka: "human" } })).json()) as { tokens: Record<string, string> };
  const row = ctx.storage.sql.exec<{ tbl: string }>("SELECT tbl FROM campaign").toArray()[0]!;
  ctx.storage.sql.exec("UPDATE campaign SET tbl = ?", JSON.stringify({ ...JSON.parse(row.tbl), vote: { match: "m1", votes: {}, picked: null } }));
  const ws = { got: [] as any[], att: null as unknown, send(m: string) { this.got.push(JSON.parse(m)); }, close() {}, serializeAttachment(v: unknown) { this.att = v; }, deserializeAttachment() { return this.att; } };
  sockets.push(ws);
  await room.webSocketMessage(ws, JSON.stringify({ t: "hello", token: tokens.wooka }));

  expect(((await (await req("/", tokens.marines)).json()) as View).vote).toEqual({ match: "m1", votes: {}, picked: null });
  expect((await req("/vote", tokens.marines, { match: "m1" })).status).toBe(400);
  const one = (await (await req("/vote", tokens.marines, { match: "m1", mode: "escort" })).json()) as View;
  expect(one.vote).toEqual({ match: "m1", votes: { marines: "escort" }, picked: null });
  expect(ws.got.at(-1)).toEqual({ t: "vote", vote: one.vote });
  expect((await req("/vote", tokens.marines, { match: "m1", mode: "hill" })).status).toBe(409);
  const both = (await (await req("/vote", tokens.wooka, { match: "m1", mode: "escort" })).json()) as View;
  expect(both.vote!.picked).toBe("escort");
  expect(both.campaign.mode).toBe("escort");
});
