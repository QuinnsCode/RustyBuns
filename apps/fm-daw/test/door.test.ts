// Qollab Studio's front door, the way two friends meet it: both sign in with eqosys, Ada makes a room and is its leader,
// Bo opens her invite link and walks into the same sesh, and each sees the other wearing the character kept on eqosys.
// The page's steps are its own functions (door.ts, account.ts, the eqosys client, the jam's live line), run against the
// Worker's /ws and a real World on a fake platform; eqosys is a stand-in serving its JWKS, the exchange and /me/avatar.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { eqosys } from "@rustybuns/util/eqosys";
import { jwksOf, newKey, sign } from "@rustybuns/util/token";
import { randomAvatar, type Avatar } from "@rustybuns/util/avatar";
import { mulberry32 } from "@rustybuns/util";
import World from "../packages/desktop/world.ts";
import worker from "../src/worker.ts";
import { APP, eqosysAvatar, SIGN_IN_FROM } from "../src/account.ts";
import { fromLink, inviteLink, loadRecent, remember, roomId, saveRecent } from "../src/studio/door.ts";
import { decodeServer } from "../src/project.ts";
import { body, hear, newJam, walkTo } from "../src/studio/jam.ts";
import { LIVE_ROOM, ROOMS } from "../src/studio/rooms/index.ts";

// ---- eqosys, standing in: two people, each with a saved character
const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const people: Record<string, { id: string; name: string; look: unknown }> = {
  eq_ada: { id: "u_ada", name: "Ada", look: randomAvatar(mulberry32(3)) },
  eq_bo: { id: "u_bo", name: "Bo", look: randomAvatar(mulberry32(9)) },
};
const handoff = (p: { id: string; name: string }) => ({ user: { id: p.id, email: `${p.name.toLowerCase()}@example.com`, name: p.name }, app: APP, source: APP, access: ["play"] });
let EQ = "";
const tokens = new Map<string, string>();
const fake = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
  const u = new URL(req.url);
  if (u.pathname === "/.well-known/jwks.json") return Response.json(await jwksOf(signer));
  if (u.pathname === "/api/exchange") {
    const { code } = await req.json() as { code: string };
    const token = (await sign(signer, EQ, handoff(people[code]!)))!;
    tokens.set(token, code);
    return Response.json({ ...handoff(people[code]!), token });
  }
  if (u.pathname === "/me/avatar") {
    const who = tokens.get(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
    if (!who) return new Response("sign in", { status: 401 });
    return Response.json({ avatar: people[who]!.look, saved: true });
  }
  return new Response("", { status: 404 });
} });
EQ = `http://127.0.0.1:${fake.port}`;
afterAll(() => fake.stop(true));

// ---- a browser per person: its own storage and address bar
const SITE = SIGN_IN_FROM[0]!;
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const g = globalThis as Record<string, unknown>;
function browser() {
  const b = { local: mem(), session: mem(), address: `${SITE}/jam.html`, went: "" };
  return b;
}
function use(b: ReturnType<typeof browser>) {
  const loc = () => { const u = new URL(b.address); return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assign: (to: string) => { b.went = to; } }; };
  g.localStorage = b.local; g.sessionStorage = b.session; g.location = loc();
  g.history = { replaceState: (_: unknown, __: string, to: string) => { b.address = new URL(to, b.address).href; g.location = loc(); } };
}
const real = { localStorage: g.localStorage, sessionStorage: g.sessionStorage, location: g.location, history: g.history };
afterAll(() => Object.assign(g, real));

/** Sign in from the page they're on, the way its button does, with `then` the page's query (an invite's room). */
async function signIn(b: ReturnType<typeof browser>, code: string) {
  use(b);
  const client = eqosys({ app: APP, url: EQ, from: SIGN_IN_FROM, prefix: "qollab-studio" });
  await client.signIn(location.search);
  const sent = new URL(b.went);
  expect(sent.searchParams.get("return")).toBe(`${SITE}/jam.html`);
  b.address = `${SITE}/jam.html?code=${code}&state=${sent.searchParams.get("state")}`; use(b);
  const back = await client.finishSignIn();
  // an invite's room came along as `then`, and the page opens it
  if (back?.then.startsWith("?")) { b.address = `${SITE}/jam.html${back.then}`; use(b); }
  return { client, login: back!.login! };
}

// ---- the edge: the Worker's /ws, into one real World per room on a fake platform
class Sock {
  readyState = 1; sent: any[] = []; att: unknown;
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; }
  serializeAttachment(v: unknown) { this.att = v; }
  deserializeAttachment() { return this.att; }
}
const RealResponse = Response;
beforeAll(() => {
  g.WebSocketPair = class { 0 = new Sock(); 1 = new Sock(); };
  g.Response = class extends RealResponse { constructor(b: any, init?: any) { super(b, init?.status === 101 ? { status: 200 } : init); } };
});
afterAll(() => { delete g.WebSocketPair; g.Response = RealResponse; });
const worlds = new Map<string, { world: World; sockets: Sock[] }>();
function room(name: string) {
  if (worlds.has(name)) return worlds.get(name)!;
  const store = new Map<string, unknown>(), sockets: Sock[] = [];
  const ctx = {
    storage: { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, v); }, delete: async (k: string) => store.delete(k), setAlarm: async () => {}, deleteAlarm: async () => {} },
    getWebSockets: () => sockets.filter((s) => s.readyState === 1), acceptWebSocket: (s: Sock) => { sockets.push(s); },
    blockConcurrencyWhile: (f: () => Promise<unknown>) => void f(),
  };
  const r = { world: new World(ctx as never, {}), sockets };
  worlds.set(name, r);
  return r;
}
const env = {
  EQOSYS_URL: EQ, ASSETS: { fetch: async () => new Response("page") },
  WORLD: { idFromName: (n: string) => n, get: (n: unknown) => ({ fetch: (r: Request) => room(String(n)).world.fetch(r) }) },
  LOBBY: { idFromName: () => "lobby", get: () => ({ fetch: async () => RealResponse.json({ ok: true }) }) },
  PROFILE: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response("{}") }) },
};
/** The page's socket into the room its address names: the sesh key it keeps, and its eqosys token. */
async function walkIn(token: string, key: string) {
  const here = fromLink(location.search)!;
  const r = await worker.fetch(new Request(`${SITE}/ws?${new URLSearchParams({ room: here.room, key, token })}`, { headers: { Upgrade: "websocket" } }), env as never);
  return { status: r.status, ws: room(here.room).sockets.at(-1)! };
}

test("two friends: Ada signs in and makes a room she leads, Bo joins from her link, and each sees the other's eqosys character", async () => {
  const ada = browser(), bo = browser();
  const a = await signIn(ada, "eq_ada");
  expect(a.login.name).toBe("Ada");
  const adaLook = await eqosysAvatar(EQ, a.login.token);
  expect(adaLook).toEqual(people.eq_ada!.look as Avatar);

  // Make a room: a name and a studio, kept in her rooms as hers, and she walks in first, so the sesh is hers to lead
  const id = roomId("Friday jam!", mulberry32(1));
  expect(id).toMatch(/^friday-jam-[a-z2-9]{4}$/);
  const link = inviteLink(SITE, id, LIVE_ROOM.id, "Friday jam!");
  saveRecent(remember(loadRecent(), { room: id, name: "Friday jam!", studio: LIVE_ROOM.id, mine: true, at: 1 }));
  ada.address = link; use(ada);
  const A = await walkIn(a.login.token, "a".repeat(32));
  expect(A.ws.sent).toContainEqual({ t: "floor", state: "free", host: true });

  // Bo opens the link signed out: eqosys sign-in, and back into the same room under its name
  bo.address = link; use(bo);
  expect(fromLink(location.search)).toEqual({ room: id, studio: LIVE_ROOM.id, name: "Friday jam!" });
  const b = await signIn(bo, "eq_bo");
  expect(fromLink(location.search)?.room).toBe(id);
  saveRecent(remember(loadRecent(), { room: id, name: "Friday jam!", studio: LIVE_ROOM.id, mine: false, at: 2 }));
  expect(loadRecent().map((r) => [r.name, r.mine])).toEqual([["Friday jam!", false]]);
  const boLook = (await eqosysAvatar(EQ, b.login.token))!;
  expect(boLook).toEqual(people.eq_bo!.look as Avatar);
  // a reply of the wrong shape (or none: eqosys down, signed out) is no character, and the page keeps its own look
  const saved = people.eq_bo!.look;
  people.eq_bo!.look = { hat: "a hat" };
  expect(await eqosysAvatar(EQ, b.login.token)).toBeNull();
  people.eq_bo!.look = saved;
  expect(await eqosysAvatar(EQ, "not-a-token")).toBeNull();
  const B = await walkIn(b.login.token, "b".repeat(32));
  expect(B.ws.sent).toContainEqual({ t: "floor", state: "free", host: false });

  // each page says who it is on the live line, wearing its character, and reads the other's
  const { world } = room(id);
  const jams = { a: newJam(ROOMS[LIVE_ROOM.id]!), b: newJam(LIVE_ROOM) };
  const live = (ws: Sock, e: object) => world.webSocketMessage(ws, JSON.stringify({ t: "live", e }));
  A.ws.sent = []; B.ws.sent = [];
  walkTo(jams.a, 1, 1);
  live(A.ws, { t: "wear", avatar: adaLook, name: a.login.name }); live(A.ws, body(jams.a));
  live(B.ws, { t: "wear", avatar: boLook, name: b.login.name }); live(B.ws, body(jams.b));
  const read = (ws: Sock, j: typeof jams.a) => { for (const m of ws.sent.splice(0)) { const d = decodeServer(m); if (d?.t === "live") hear(j, d.from, d.e); } };
  read(A.ws, jams.a); read(B.ws, jams.b);
  expect([...jams.b.others.values()].map((o) => [o.name, o.avatar])).toEqual([["Ada", adaLook]]);
  expect([...jams.a.others.values()].map((o) => [o.name, o.avatar])).toEqual([["Bo", boLook]]);

  // a token eqosys didn't sign gets no seat: sign in again
  const forged = (await sign({ EQOSYS_SIGNING_KEY: await newKey() }, EQ, handoff(people.eq_bo!)))!;
  expect((await walkIn(forged, "c".repeat(32))).status).toBe(401);
});
