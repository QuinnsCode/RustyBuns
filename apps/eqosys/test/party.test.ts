// Two players of one app join the same party code and each sees the other; a token for another app is refused.
// Voice: a member takes a one-use Qlave ticket into the party's room, the host's mute and kick reach a fake Qlave as
// orders, and the host's account going ends the room.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { checkerFor, jwksOf, newKey, peek, startTicket, verify } from "@rustybuns/util/token";
import { unb64url } from "@rustybuns/util/bytes";
import { handle } from "../src/handle.ts";
import { party, type PartyMember } from "@rustybuns/util/eqosys";
import { Party, type PartyOut } from "../src/qollab/party.ts";
import { Hub, hubAsk } from "../src/qollab/hub.ts";
import { asks, boot, codeIn, ORIGIN, PARK, PASSWORD, QCRM } from "./kit.ts";

setDefaultTimeout(30_000);

const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
conf.PARTY = durableObject(Party as never, conf) as never;
const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
shell.mount({ fetch: async (req: Request) => (await handle(req, conf)) ?? new Response("no", { status: 404 }) } as never, {});
// Qlave, as far as eqosys can tell: POST /eqosys with an admin token from eqosys's key, else 401.
const orders: unknown[] = [];
const qlave = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!await verify(token, await jwksOf(conf), { iss: ORIGIN, aud: "qlave-admin" })) return new Response("Unauthorized", { status: 401 });
  orders.push(await req.json());
  return Response.json({ ok: true });
} });
conf.QLAVE_URL = `http://127.0.0.1:${qlave.port}`;
afterAll(() => { shell.stop(); qlave.stop(true); });

async function signUp(name: string, app: string, origin: string) {
  const a = await asks(app, origin);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const who = await (await call("/api/exchange", { json: { app, code: codeIn(up.to), verifier: a.verifier } })).res.json() as { token: string };
  return who.token;
}

function join(code: string, token: string, origin: string) {
  const got: Extract<PartyOut, { t: "members" }>[] = [];
  // The token rides as a subprotocol, out of the URL access logs keep (knock below still uses the iOS kit's ?token=).
  const ws = new WebSocket(`ws://127.0.0.1:${shell.port}/q/party/${code}`, { headers: { origin }, protocols: ["eqosys", token] } as never);
  ws.onmessage = (e) => { const m: PartyOut = JSON.parse(String(e.data)); if (m.t === "members") got.push(m); };
  return { ws, names: () => got.at(-1)?.members.map((m) => m.name).sort() };
}
const until = async (f: () => unknown) => { const end = Date.now() + 10_000; while (!(await f())) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };
const knock = (code: string, token: string, origin: string) => fetch(`http://127.0.0.1:${shell.port}/q/party/${code}?token=${token}`, {
  headers: { upgrade: "websocket", connection: "upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13", origin },
});

const mint = async (token: string) => fetch(`http://127.0.0.1:${shell.port}/q/party?open=1`, { method: "POST", headers: { authorization: `Bearer ${token}` } });

test("two players join one code and see each other; another app's token is a 403", async () => {
  const ada = await signUp("Ada", "park-hide-seek", PARK);
  const bo = await signUp("Bo", "park-hide-seek", PARK);
  const cy = await signUp("Cy", "qcrm", QCRM);

  const made = await (await mint(ada)).json() as { code: string };
  expect(made.code).toMatch(/^[BCDFGHJKLMNPQRSTVWXYZ]{6}$/);
  const KRTZ = made.code;
  const a = join(KRTZ, ada, PARK);
  await until(() => a.names()?.join() === "Ada");
  expect(a.ws.protocol).toBe("eqosys");
  const b = join(KRTZ.toLowerCase(), bo, PARK);
  await until(() => a.names()?.join() === "Ada,Bo" && b.names()?.join() === "Ada,Bo");

  expect((await knock(KRTZ, cy, QCRM)).status).toBe(403);
  expect((await knock("KRTZ", "nope", PARK)).status).toBe(401);
  expect((await knock("no", ada, PARK)).status).toBe(400);

  b.ws.close();
  await until(() => a.names()?.join() === "Ada");
  a.ws.close();
});

test("two players make a party, join by code, ready up, start, and both land in the same room", async () => {
  const base = `http://127.0.0.1:${shell.port}`;
  const adaToken = await signUp("Ada3", "park-hide-seek", PARK), boToken = await signUp("Bo3", "park-hide-seek", PARK);
  const ada = party({ url: () => base, token: () => adaToken }), bo = party({ url: () => base, token: () => boToken });
  const seen: Record<string, PartyMember[]> = {}, landed: Record<string, { room: string; seat: number; ticket?: string }> = {}, refused: string[] = [];
  ada.onMembers((m) => (seen.ada = m)); bo.onMembers((m) => (seen.bo = m));
  ada.onStart((s) => (landed.ada = s)); bo.onStart((s) => (landed.bo = s));
  ada.onRefused((w) => refused.push(w));

  const code = (await ada.make(true))!;
  expect(code).toBeTruthy();
  ada.join(code);
  await until(() => seen.ada?.length === 1);
  bo.join(code);
  await until(() => seen.ada?.length === 2 && seen.bo?.length === 2);

  ada.start(); // Bo isn't ready
  await until(() => refused.length === 1);
  expect(refused[0]).toContain("Bo3");
  bo.start(); // not the host's to press
  bo.ready(true);
  await until(() => seen.ada?.find((m) => m.name === "Bo3")?.ready);
  ada.start();
  await until(() => landed.ada && landed.bo);
  expect(landed.ada!.room).toBe(code);
  expect(landed.bo!.room).toBe(code);
  expect([landed.ada!.seat, landed.bo!.seat]).toEqual([0, 1]);
  // Each start carries eqosys's word on the room and seat, for the game's Worker to check against the JWKS (#3883).
  const ticket = landed.bo!.ticket!, iss = peek(ticket)!.iss, jwks = () => fetch(`${base}/.well-known/jwks.json`);
  expect(await startTicket(iss, "park-hide-seek", ticket, jwks)).toEqual({ sub: peek(boToken)!.sub, room: code, seat: 1 });
  // It is no login for the game, and it is for this app's starts only.
  expect(await checkerFor(iss, "park-hide-seek", jwks).check(ticket)).toBeNull();
  expect(await startTicket(iss, "qcrm", ticket, jwks)).toBeNull();

  ada.leave(); bo.leave();
});

test("deleting an account takes the person out of every party they sat in; deleting the host ends the party", async () => {
  const [adaToken, boToken] = [await signUp("Ada4", "park-hide-seek", PARK), await signUp("Bo4", "park-hide-seek", PARK)];
  const code = ((await (await mint(adaToken)).json()) as { code: string }).code;
  const a = join(code, adaToken, PARK), b = join(code, boToken, PARK);
  await until(() => a.names()?.join() === "Ada4,Bo4");
  const seats = async () => (await conf.DB.prepare("SELECT user_id FROM party_seats WHERE code = ?").bind(code).all<{ user_id: string }>()).results.length;
  expect(await seats()).toBe(2);

  const del = (token: string) => call("/api/account/delete", { json: {}, bearer: token, origin: PARK });
  const boId = (await conf.DB.prepare("SELECT id FROM \"user\" WHERE name = 'Bo4'").first<string>("id"))!;
  await conf.DB.prepare("INSERT INTO saves (user_id, app, slot, at, size, data) VALUES (?, 'park-hide-seek', 'run', 1, 1, x'00')").bind(boId).run();
  const saves = async () => (await conf.DB.prepare("SELECT COUNT(*) AS n FROM saves WHERE user_id = ?").bind(boId).first<number>("n"))!;
  expect(await saves()).toBe(1);
  expect((await (await del(boToken)).res.json())).toEqual({ ok: true });
  expect(await saves()).toBe(0);
  await until(() => a.names()?.join() === "Ada4");
  expect(await seats()).toBe(1);

  expect((await (await del(adaToken)).res.json())).toEqual({ ok: true });
  expect(await seats()).toBe(0);
  expect((await knock(code, await signUp("Cy4", "park-hide-seek", PARK), PARK)).status).toBe(404);
  a.ws.close(); b.ws.close();
});

test("a party has a voice room: a ticket into it, the host's mute and kick reach Qlave, and the host going ends it", async () => {
  const base = `http://127.0.0.1:${shell.port}`;
  const adaToken = await signUp("Ada5", "park-hide-seek", PARK), boToken = await signUp("Bo5", "park-hide-seek", PARK);
  const ada = party({ url: () => base, token: () => adaToken }), bo = party({ url: () => base, token: () => boToken });
  const seen: Record<string, PartyMember[]> = {}, tickets: { url: string; ticket: string }[] = [];
  ada.onMembers((m) => (seen.ada = m)); bo.onMembers((m) => (seen.bo = m));
  bo.onTicket((t) => tickets.push(t));
  const code = (await ada.make(true))!;
  ada.join(code); bo.join(code);
  await until(() => seen.ada?.length === 2);
  orders.length = 0; // the accounts deleted above were erased on Qlave too

  // A ticket: eqosys's key, for Qlave, this person and the party's room, one use, a minute.
  bo.talk();
  await until(() => tickets.length === 1);
  const t = tickets[0]!, boId = peek(boToken)!.sub;
  expect(t.url).toBe(conf.QLAVE_URL!);
  const claims = await verify(t.ticket, await jwksOf(conf), { iss: ORIGIN, aud: "qlave" });
  expect(claims && { sub: claims.sub, life: claims.exp - claims.iat }).toEqual({ sub: boId, life: 60 });
  const { room } = JSON.parse(new TextDecoder().decode(unb64url(t.ticket.split(".")[1]!))) as { room: string };
  expect(room).toMatch(new RegExp(`^party:${code}:[0-9a-f]{8}$`));

  // Bo's page says it joined: Ada sees Bo in voice.
  bo.inVoice(true);
  await until(() => seen.ada!.find((m) => m.name === "Bo5")?.voice === true);

  // The host's mute is a voice mute, and a muted member's next ticket comes after their mute is in the room.
  ada.mute(boId);
  await until(() => orders.length === 1);
  expect(orders.shift()).toEqual({ t: "mute", room, sub: boId, on: true });
  bo.talk();
  await until(() => tickets.length === 2);
  expect(orders.shift()).toEqual({ t: "mute", room, sub: boId, on: true });

  // Taken out of the party is out of the room.
  ada.kick(boId);
  await until(() => orders.length === 1);
  expect(orders.shift()).toEqual({ t: "kick", room, sub: boId });

  // The host's account deleted: the party ends, and so does its room.
  await call("/api/account/delete", { json: {}, bearer: adaToken, origin: PARK });
  await until(() => orders.some((o) => (o as { t: string }).t === "end"));
  expect(orders).toContainEqual({ t: "end", prefix: room });
  ada.leave(); bo.leave();
});

// Last: it uses up this address's mints.
test("two people who met in a party each press Add friend on the other and are friends; someone outside it can't be asked", async () => {
  conf.HUB = durableObject(Hub as never, conf) as never;
  const base = `http://127.0.0.1:${shell.port}`;
  const adaToken = await signUp("Ada6", "park-hide-seek", PARK), boToken = await signUp("Bo6", "park-hide-seek", PARK), cyToken = await signUp("Cy6", "park-hide-seek", PARK);
  const ada = party({ url: () => base, token: () => adaToken }), bo = party({ url: () => base, token: () => boToken });
  const seen: Record<string, PartyMember[]> = {}, refused: string[] = [];
  ada.onMembers((m) => (seen.ada = m)); bo.onMembers((m) => (seen.bo = m)); ada.onRefused((w) => refused.push(w));
  const code = (await ada.make(true))!;
  ada.join(code); bo.join(code);
  await until(() => seen.ada?.length === 2 && seen.bo?.length === 2);
  const who = (token: string, name: string) => ({ id: peek(token)!.sub, name, app: "park-hide-seek" });
  const friendsOf = async (token: string, name: string) => { const s = await hubAsk(conf.HUB!, who(token, name), { op: "state" }); return "error" in s ? s.error : s.friends.map((f) => f.name); };

  ada.befriend(peek(cyToken)!.sub);
  await until(() => refused.length === 1);
  expect(refused[0]).toBe("They aren't in this party.");

  ada.befriend(peek(boToken)!.sub);
  await until(async () => (await hubAsk(conf.HUB!, who(boToken, "Bo6"), { op: "state" }).then((s) => "incoming" in s && s.incoming.length)));
  expect(await friendsOf(adaToken, "Ada6")).toEqual([]);
  bo.befriend(peek(adaToken)!.sub);
  await until(async () => (await friendsOf(adaToken, "Ada6")).length === 1);
  expect(await friendsOf(adaToken, "Ada6")).toEqual(["Bo6"]);
  expect(await friendsOf(boToken, "Bo6")).toEqual(["Ada6"]);
  ada.leave(); bo.leave();
  delete conf.HUB;
});

test("a made code joins; a wrong code is a 404; the thirteenth mint in a minute is refused", async () => {
  const ada = await signUp("Ada2", "park-hide-seek", PARK);
  expect((await knock("BCDFGH", ada, PARK)).status).toBe(404);
  expect((await mint("nope")).status).toBe(401);
  const codes = new Set<string>();
  for (let i = 0; i < 12; i++) { const r = await mint(ada); if (r.ok) codes.add(((await r.json()) as { code: string }).code); }
  // The first test already minted one from this address, so the gate (12 a minute) closes before the loop ends.
  expect(codes.size).toBeLessThan(12);
  expect((await mint(ada)).status).toBe(429);
  expect((await knock([...codes][0]!, ada, PARK)).status).toBe(101);
});

