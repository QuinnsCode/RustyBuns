// The campaign's Durable Object behind the Worker, hosted in-process by Rusty Buns with the same
// SQLite storage shape Cloudflare gives it.
import { expect, test } from "bun:test";
import { durableObject } from "@rustybuns/shell-bun";
import worker, { CampaignRoom } from "../src/edge/worker.ts";
import { STARTS_PER_MINUTE, allowStart } from "../src/edge/limits.ts";
import type { View } from "../src/edge/campaign.ts";
import type { TurnRecord } from "../src/war/table.ts";

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
  expect(JSON.parse(peek).campaign.systems.nyx.sectors[0].armies.wooka).toBe(2);

  const resolved = (await (await call(`/api/campaigns/${id}/orders`, tokens.marines, { faction: "marines", orders: [] })).json()) as View;
  expect(resolved.campaign.turn).toBe(2);
  expect(resolved.waiting).toEqual(["marines", "wooka"]);
  expect(resolved.campaign.systems.nyx!.sectors[0]!.armies.wooka).toBe(3);

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
  const v = (await (await call(`/api/campaigns/${id}/orders`, tokens.wooka, { faction: "wooka", orders: [] })).json()) as View;
  expect(v.campaign.turn).toBe(2);
});

test("campaigns that were never started, bad ids and bad seats", async () => {
  expect((await call(`/api/campaigns/${"a".repeat(64)}`, "x".repeat(32))).status).toBe(404);
  expect((await call("/api/campaigns/not-an-id")).status).toBe(404);
  expect((await call("/api/campaigns", undefined, { seats: { marines: "ai", wooka: "ai" } })).status).toBe(400);
  expect((await call("/api/campaigns", undefined, { seats: { marines: "robot" } })).status).toBe(400);
  expect(await (await call("/")).text()).toBe("the page");
});

test("an address can start only so many campaigns a minute", () => {
  for (let i = 0; i < STARTS_PER_MINUTE; i++) expect(allowStart("1.2.3.4", 1000 + i)).toBe(true);
  expect(allowStart("1.2.3.4", 2000)).toBe(false);
  expect(allowStart("5.6.7.8", 2000)).toBe(true);
  expect(allowStart("1.2.3.4", 62_000)).toBe(true);
});
