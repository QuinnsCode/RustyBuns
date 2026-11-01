// Two players of one app join the same party code and each sees the other; a token for another app is refused.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { newKey } from "@rustybuns/util/token";
import { handle } from "../src/handle.ts";
import { party, type PartyMember } from "@rustybuns/util/eqosys";
import { Party, type PartyOut } from "../src/party.ts";
import { asks, boot, codeIn, PARK, PASSWORD, QCRM } from "./kit.ts";

setDefaultTimeout(30_000);

const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
conf.PARTY = durableObject(Party as never, conf) as never;
const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
shell.mount({ fetch: async (req: Request) => (await handle(req, conf)) ?? new Response("no", { status: 404 }) } as never, {});
afterAll(() => shell.stop());

async function signUp(name: string, app: string, origin: string) {
  const a = await asks(app, origin);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const who = await (await call("/api/exchange", { json: { app, code: codeIn(up.to), verifier: a.verifier } })).res.json() as { token: string };
  return who.token;
}

function join(code: string, token: string, origin: string) {
  const got: Extract<PartyOut, { t: "members" }>[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${shell.port}/q/party/${code}?token=${token}`, { headers: { origin } } as never);
  ws.onmessage = (e) => { const m: PartyOut = JSON.parse(String(e.data)); if (m.t === "members") got.push(m); };
  return { ws, names: () => got.at(-1)?.members.map((m) => m.name).sort() };
}
const until = async (f: () => unknown) => { const end = Date.now() + 10_000; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };
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
  const seen: Record<string, PartyMember[]> = {}, landed: Record<string, { room: string; seat: number }> = {}, refused: string[] = [];
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

  ada.leave(); bo.leave();
});

// Last: it uses up this address's mints.
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

