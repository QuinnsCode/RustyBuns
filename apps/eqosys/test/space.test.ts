// Spaces: one person makes a space, a friend joins by invite from another app, they talk in #general, the owner adds a
// channel, history comes back on a fresh socket, a kicked member is out, and deleting the owner deletes the space.
// Voice: the owner adds a voice channel, a member takes a one-use Qlave ticket and says they joined, and the owner's
// mute, kick and delete reach a fake Qlave as orders (one that answers 503 at first, so the outbox has to retry).
// Qlave's signed roster of who is in a room wins over what the page says.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { space, type SpaceMessage } from "@rustybuns/util/eqosys";
import { jwksOf, newKey, verify } from "@rustybuns/util/token";
import { hex, unb64url } from "@rustybuns/util/bytes";
import { handle } from "../src/handle.ts";
import { Space } from "../src/space.ts";
import { asks, boot, codeIn, ORIGIN, PARK, PASSWORD, QCRM } from "./kit.ts";

setDefaultTimeout(30_000);

const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
conf.SPACE = durableObject(Space as never, conf) as never;
const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
shell.mount({ fetch: async (req: Request) => (await handle(req, conf)) ?? new Response("no", { status: 404 }) } as never, {});
// Qlave, as far as eqosys can tell: POST /eqosys with an admin token from eqosys's key, else 401. `down` answers 503 that many times first.
const orders: unknown[] = [];
let down = 0;
const qlave = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!await verify(token, await jwksOf(conf), { iss: ORIGIN, aud: "qlave-admin" })) return new Response("Unauthorized", { status: 401 });
  if (down > 0) { down--; return new Response("busy", { status: 503 }); }
  orders.push(await req.json());
  return Response.json({ ok: true });
} });
conf.QLAVE_URL = `http://127.0.0.1:${qlave.port}`;
afterAll(() => { shell.stop(); qlave.stop(true); });
const base = `http://127.0.0.1:${shell.port}`;

async function signUp(name: string, app: string, origin: string) {
  const a = await asks(app, origin);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const who = await (await call("/api/exchange", { json: { app, code: codeIn(up.to), verifier: a.verifier } })).res.json() as { user: { id: string }; token: string };
  return { id: who.user.id, token: who.token };
}
const until = async (f: () => unknown) => { const end = Date.now() + 10_000; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };

/** A member's page: what it has heard, kept by channel. */
function member(token: string) {
  const c = space({ url: () => base, token: () => token });
  const heard: Record<string, string[]> = {}, refused: string[] = [];
  let channels: string[] = [], online: string[] = [], gone = "", history: SpaceMessage[] = [], more = false;
  let voice: { id: string; name: string }[] = [], tickets: { channel: string; url: string; ticket: string }[] = [];
  const open = (id: string) => c.open(id, {
    space: (s) => { channels = s.channels; voice = s.voice; },
    online: (m) => (online = m.map((x) => x.voice ? `${x.name} in ${x.voice}` : x.name).sort()),
    ticket: (channel, url, ticket) => tickets.push({ channel, url, ticket }),
    said: (ch, m) => (heard[ch] ??= []).push(`${m.from.name}: ${m.text}`),
    history: (_, m, mo) => { history = m; more = mo; },
    refused: (w) => refused.push(w),
    gone: (w) => (gone = w),
  });
  return { c, open, heard, refused, channels: () => channels, voice: () => voice, tickets: () => tickets, online: () => online, gone: () => gone, history: () => history, more: () => more };
}

test("make, invite, talk, add a channel, read history, kick; a member from another app is in too", async () => {
  const ada = await signUp("Ada", "park-hide-seek", PARK), bo = await signUp("Bo", "qcrm", QCRM);
  const a = member(ada.token), b = member(bo.token);

  const made = (await a.c.make("Night owls"))!;
  expect(made.invite).toMatch(/^[BCDFGHJKLMNPQRSTVWXYZ]{6}$/);
  expect(await b.c.join("WRONG1")).toBeNull();
  expect(await b.c.join(made.invite.toLowerCase())).toEqual({ id: made.id, name: "Night owls" });
  expect(await a.c.mine()).toEqual([{ id: made.id, name: "Night owls", owner: true, invite: made.invite }]);
  expect(await b.c.mine()).toEqual([{ id: made.id, name: "Night owls", owner: false }]);

  a.open(made.id); b.open(made.id);
  await until(() => a.online().join() === "Ada,Bo" && b.channels().join() === "general");
  b.c.say("general", "evening");
  await until(() => a.heard.general?.includes("Bo: evening"));

  b.c.channel("games"); // not Bo's to add
  await until(() => b.refused.length === 1);
  a.c.channel("games");
  await until(() => b.channels().join() === "general,games");
  a.c.say("games", "party at nine");
  await until(() => b.heard.games?.includes("Ada: party at nine"));
  expect(a.heard.general).toEqual(["Bo: evening"]);

  // A fresh socket reads back what was said, oldest first, a page at a time.
  // Sixty lines: each tab has its own burst of five, so twelve tabs say them without waiting out the rate.
  for (let tab = 0; tab < 12; tab++) {
    const t = member(ada.token);
    t.open(made.id);
    await until(() => t.channels().length);
    for (let i = 1; i <= 5; i++) t.c.say("general", `n${tab * 5 + i}`);
    await until(() => b.heard.general?.length === 1 + (tab + 1) * 5);
    t.c.close();
  }
  const later = member(bo.token);
  later.open(made.id);
  later.c.history("general");
  await until(() => later.history().length === 50);
  expect(later.history().at(-1)!.text).toBe("n60");
  expect(later.more()).toBe(true);
  later.c.history("general", later.history()[0]!.id);
  await until(() => later.history()[0]?.text === "evening");
  expect(later.history().length).toBe(11);
  expect(later.more()).toBe(false);
  later.c.close();

  a.c.kick(bo.id);
  await until(() => b.gone() === "removed from the space");
  expect(await b.c.mine()).toEqual([]);
  b.open(made.id);
  await until(() => b.gone() === "Not a space you're in.");
  a.c.close();
});

test("deleting the owner's account deletes their space for everyone", async () => {
  const ada = await signUp("Ada2", "park-hide-seek", PARK), bo = await signUp("Bo2", "park-hide-seek", PARK);
  const a = member(ada.token), b = member(bo.token);
  const made = (await a.c.make("Short lived"))!;
  await b.c.join(made.invite);
  b.open(made.id);
  await until(() => b.online().join() === "Bo2");

  expect(await (await call("/api/account/delete", { json: {}, bearer: ada.token, origin: PARK })).res.json()).toEqual({ ok: true });
  await until(() => b.gone() === "the space was deleted");
  expect(await b.c.mine()).toEqual([]);
});

/** Qlave's POST of who is in a room, signed the way Qlave signs it (`sig` overrides the signature). */
conf.QLAVE_ROSTER_SECRET = "test-roster-secret";
async function roster(room: string, people: { sub: string; name: string }[], at = Date.now(), sig?: string) {
  const body = JSON.stringify({ room, in: people, at });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(conf.QLAVE_ROSTER_SECRET!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = sig ?? hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return (await fetch(`${base}/q/qlave/roster`, { method: "POST", body, headers: { "x-qlave-signature": signature } })).status;
}

/** A ticket's claims as Qlave reads them, extras (room, jti) included. */
const claimsOf = (t: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(unb64url(t.split(".")[1]!)));

test("voice: a member takes a ticket into a voice channel, and the owner's mute, kick and delete reach Qlave", async () => {
  const ada = await signUp("Vada", "park-hide-seek", PARK), bo = await signUp("Vbo", "qcrm", QCRM);
  const a = member(ada.token), b = member(bo.token);
  const made = (await a.c.make("Voice night"))!;
  await b.c.join(made.invite);
  a.open(made.id); b.open(made.id);
  await until(() => a.online().length === 2);
  orders.length = 0; // the account deleted above ended its space on Qlave too

  b.c.channel("lounge", true); // only the owner adds channels
  await until(() => b.refused.length === 1);
  a.c.channel("lounge", true);
  await until(() => b.voice().length === 1);
  const lounge = b.voice()[0]!;
  expect(lounge).toEqual({ id: expect.stringMatching(/^v[0-9a-f]{8}$/), name: "lounge" });
  expect(b.channels()).toEqual(["general"]);
  const room = `space:${made.id}:${lounge.id}`;

  // A ticket: eqosys's key, for Qlave, this person and this room, one use (a jti), a minute.
  b.c.talk(lounge.id);
  await until(() => b.tickets().length === 1);
  const t = b.tickets()[0]!;
  expect(t.url).toBe(conf.QLAVE_URL!);
  const claims = await verify(t.ticket, await jwksOf(conf), { iss: ORIGIN, aud: "qlave" });
  expect(claims && { sub: claims.sub, name: claims.name, life: claims.exp - claims.iat }).toEqual({ sub: bo.id, name: "Vbo", life: 60 });
  expect(claimsOf(t.ticket)).toMatchObject({ room, jti: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  b.c.talk("vnope0000");
  await until(() => b.refused.at(-1) === "no such voice channel");

  // The page says it joined Qlave's room: everyone sees it beside the online list.
  b.c.inVoice(lounge.id);
  await until(() => a.online().includes(`Vbo in ${lounge.id}`));

  // Qlave's roster wins over the page: someone it lists shows in the room, and an empty one takes them out though
  // their page still says it's in. A wrong signature is 401, an old clock 400.
  b.c.inVoice();
  await until(() => a.online().join() === "Vada,Vbo");
  expect(await roster(room, [{ sub: bo.id, name: "Vbo" }], Date.now(), "0".repeat(64))).toBe(401);
  expect(await roster(room, [{ sub: bo.id, name: "Vbo" }])).toBe(200);
  await until(() => a.online().includes(`Vbo in ${lounge.id}`));
  b.c.inVoice(lounge.id);
  expect(await roster(room, [])).toBe(200);
  await until(() => a.online().join() === "Vada,Vbo");
  expect(await roster(room, [{ sub: bo.id, name: "Vbo" }], Date.now() - 120_000)).toBe(400);

  // Mute reaches Qlave even when it is busy at first: the outbox tries again.
  down = 1;
  a.c.mute(bo.id);
  await until(() => orders.length === 1);
  expect(orders.shift()).toEqual({ t: "mute", room, sub: bo.id, on: true });
  // A muted member's next ticket comes after their mute is in Qlave's room.
  b.c.talk(lounge.id);
  await until(() => b.tickets().length === 2);
  expect(orders.shift()).toEqual({ t: "mute", room, sub: bo.id, on: true });

  // Deleting the voice channel ends its room, and nobody shows in it any more.
  a.c.channel("radio", true);
  await until(() => b.voice().length === 2);
  a.c.drop(lounge.id);
  await until(() => b.voice().map((v) => v.name).join() === "radio" && a.online().join() === "Vada,Vbo");
  await until(() => orders.length === 1);
  expect(orders.shift()).toEqual({ t: "end", prefix: room });

  // Kick: out of the space, and out of every voice channel on Qlave.
  const radio = b.voice()[0]!.id;
  a.c.kick(bo.id);
  await until(() => b.gone() === "removed from the space" && orders.length === 1);
  expect(orders.shift()).toEqual({ t: "kick", room: `space:${made.id}:${radio}`, sub: bo.id });

  // Deleting the owner's account deletes the space: Qlave erases them and ends every room under it.
  expect(await (await call("/api/account/delete", { json: {}, bearer: ada.token, origin: PARK })).res.json()).toEqual({ ok: true });
  await until(() => orders.length === 2);
  expect(orders.splice(0)).toEqual(expect.arrayContaining([{ t: "erase", sub: ada.id }, { t: "end", prefix: `space:${made.id}:` }]));
}, 30_000);
