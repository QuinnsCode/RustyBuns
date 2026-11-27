// Qollab Studio's front door, the way two friends meet it: both sign in with eqosys, Ada makes a room and is its leader,
// Bo opens her invite link and walks into the same sesh, and each sees the other wearing the character kept on eqosys;
// then Ada moves the room to another studio, and Bo walks into it with her.
// The page's steps are its own functions (door.ts, account.ts, the eqosys client, the jam's live line), run against the
// Worker's /ws and a real World on a fake platform; eqosys is a stand-in serving its JWKS, the exchange and /me/avatar.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { eqosys, hub, type HubNote } from "@rustybuns/util/eqosys";
import { jwksOf, newKey, sign } from "@rustybuns/util/token";
import { cleanAvatar, PARTS, randomAvatar, type Avatar } from "@rustybuns/util/avatar";
import { mulberry32 } from "@rustybuns/util";
import { invitedBy } from "@rustybuns/util/lobby";
import World from "../packages/desktop/world.ts";
import worker from "../src/worker.ts";
import { APP, eqosysAvatar, saveEqosysAvatar, SIGN_IN_FROM } from "../src/account.ts";
import { doorWords, follow, friendOrder, fromLink, inviteLink, inviteNote, invitesIn, loadRecent, remember, roomId, saveRecent } from "../src/studio/door.ts";
import { demoProject } from "../src/presets.ts";
import { decodeOp, decodeServer } from "../src/project.ts";
import { body, hear, newJam, walkTo } from "../src/studio/jam.ts";
import { LIVE_ROOM, ROOMS } from "../src/studio/rooms/index.ts";

// ---- eqosys, standing in: two people, each with a saved character
const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const people: Record<string, { id: string; name: string; look: unknown }> = {
  eq_ada: { id: "u_ada", name: "Ada", look: randomAvatar(mulberry32(3)) },
  eq_bo: { id: "u_bo", name: "Bo", look: randomAvatar(mulberry32(9)) },
  eq_cy: { id: "u_cy", name: "Cy", look: randomAvatar(mulberry32(5)) },
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
    // a PUT keeps it, if it reads as one (eqosys's Avatar guard)
    if (req.method === "PUT") { const a = cleanAvatar(await req.json().catch(() => null)); if (!a) return new Response("send an avatar", { status: 400 }); people[who]!.look = a; }
    return Response.json({ avatar: people[who]!.look, saved: true });
  }
  if (u.pathname === "/api/hub") {
    // the hub, standing in: Ada and Bo are friends, Cy is Ada's too; a note goes only to a friend
    const who = tokens.get(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
    if (!who) return Response.json({ error: "sign in" }, { status: 401 });
    const me = people[who]!, op = await req.json() as { op: string; id?: string; text?: string; link?: string };
    const mine = friendsOf[me.id] ?? [];
    if (op.op === "notify") {
      if (!op.id || !mine.includes(op.id)) return Response.json({ error: "only a friend can be notified" }, { status: 400 });
      (notes[op.id] ??= []).push({ key: `n${++noteN}`, at: noteN, kind: "note", from: { id: me.id, name: me.name }, app: APP, text: op.text, link: op.link });
    }
    const friends = mine.map((id) => ({ id, name: names[id] ?? "", presence: id === "u_bo" ? [{ app: APP, doing: "" }] : [] }));
    return Response.json({ friends, notes: notes[me.id] ?? [] });
  }
  return new Response("", { status: 404 });
} });
const names: Record<string, string> = { u_ada: "Ada", u_bo: "Bo", u_cy: "Cy" };
const friendsOf: Record<string, string[]> = { u_ada: ["u_cy", "u_bo"], u_bo: ["u_ada"] };
const notes: Record<string, HubNote[]> = {};
let noteN = 0;
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
  const kept = await eqosysAvatar(EQ, a.login.token);
  expect(kept).toEqual(people.eq_ada!.look as Avatar);
  // she changes her hair in the Character dialog: Save puts it on eqosys with her token, and that is the one she wears
  const hair = PARTS.hair.find((x) => x !== kept!.hair)!;
  expect((await saveEqosysAvatar(EQ, a.login.token, { ...kept!, hair }))?.avatar.hair).toBe(hair);
  const adaLook = await eqosysAvatar(EQ, a.login.token);
  expect(adaLook?.hair).toBe(hair);
  expect(await saveEqosysAvatar(EQ, "not-a-token", adaLook!)).toBeNull();

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

test("the leader moves the room to the console room, everyone walks into it, and the invite link names it", async () => {
  const ada = browser(), bo = browser();
  const a = await signIn(ada, "eq_ada"), b = await signIn(bo, "eq_bo");
  const id = roomId("Studio hop", mulberry32(2));
  const link = inviteLink(SITE, id, LIVE_ROOM.id, "Studio hop");
  ada.address = link; use(ada);
  const A = await walkIn(a.login.token, "d".repeat(32));
  // the maker seeds the sesh in the studio its link names
  const { world } = room(id);
  await world.webSocketMessage(A.ws, JSON.stringify({ t: "init", project: { ...demoProject(), studio: LIVE_ROOM.id } }));
  bo.address = link; use(bo);
  const B = await walkIn(b.login.token, "e".repeat(32));
  expect(B.ws.sent.find((m) => m.t === "snapshot")?.project.studio).toBe(LIVE_ROOM.id);
  expect(follow(SITE, fromLink(location.search)!, LIVE_ROOM.id)).toBeNull();

  // Bo has no Lead grant: his pick goes nowhere, and he is put back in step
  const ops = (ws: Sock) => ws.sent.splice(0).map((m) => decodeServer(m)).filter((m) => m?.t === "op" || m?.t === "snapshot");
  A.ws.sent = []; B.ws.sent = [];
  await world.webSocketMessage(B.ws, JSON.stringify({ t: "op", op: { t: "studio", id: "console-room" } }));
  expect(ops(A.ws)).toEqual([]);
  expect(ops(B.ws).map((m) => m?.t === "snapshot" && m.project?.studio)).toEqual([LIVE_ROOM.id]);

  // Ada leads: the console room goes on the sesh, kept with the groove, and Bo's page walks over into it
  await world.webSocketMessage(A.ws, JSON.stringify({ t: "op", op: { t: "studio", id: "console-room" } }));
  const heard = ops(B.ws);
  expect(heard).toEqual([{ t: "op", op: { t: "studio", id: "console-room" } }]);
  const to = follow(SITE, fromLink(location.search)!, "console-room")!;
  bo.address = to; use(bo);
  expect(fromLink(location.search)).toEqual({ room: id, studio: "console-room", name: "Studio hop" });
  // ...and his Copy invite link now names it; someone coming in later gets the sesh in the console room
  expect(new URL(inviteLink(SITE, id, fromLink(location.search)!.studio, "Studio hop")).searchParams.get("studio")).toBe("console-room");
  const C = await walkIn(b.login.token, "f".repeat(32));
  expect(C.ws.sent.find((m) => m.t === "snapshot")?.project.studio).toBe("console-room");
  // an undo (a whole groove sent back) doesn't move the room back
  C.ws.sent = [];
  await world.webSocketMessage(A.ws, JSON.stringify({ t: "op", op: { t: "replace", project: demoProject() } }));
  expect(ops(C.ws).map((m) => m?.t === "op" && m.op.t === "replace" && m.op.project.studio)).toEqual(["console-room"]);

  // the rig on the sand is the leader's call too: Bo's pick goes nowhere, Ada's goes to everyone, an undo keeps it,
  // and a rig nobody makes isn't an edit at all
  A.ws.sent = []; B.ws.sent = []; C.ws.sent = [];
  await world.webSocketMessage(B.ws, JSON.stringify({ t: "op", op: { t: "rig", id: "synergy" } }));
  expect(ops(A.ws)).toEqual([]);
  await world.webSocketMessage(A.ws, JSON.stringify({ t: "op", op: { t: "rig", id: "synergy" } }));
  expect(ops(C.ws)).toEqual([{ t: "op", op: { t: "rig", id: "synergy" } }]);
  await world.webSocketMessage(A.ws, JSON.stringify({ t: "op", op: { t: "replace", project: demoProject() } }));
  expect(ops(C.ws).map((m) => m?.t === "op" && m.op.t === "replace" && m.op.project.rig)).toEqual(["synergy"]);
  expect(decodeOp({ t: "rig", id: "wall-of-sound" })).toBeNull();

  // the room Ada built goes with her move to "yours": someone coming in later gets her room, not their own
  const mine = { ...structuredClone(LIVE_ROOM), id: "adas-room", name: "Ada's room" };
  await world.webSocketMessage(A.ws, JSON.stringify({ t: "op", op: { t: "studio", id: "yours", built: mine } }));
  const D = await walkIn(b.login.token, "g".repeat(32));
  const snap = D.ws.sent.find((m) => m.t === "snapshot")?.project;
  expect([snap?.studio, snap?.built?.name]).toEqual(["yours", "Ada's room"]);
  expect(decodeOp({ t: "studio", id: "yours", built: { name: "not a room" } })).toBeNull();
});

test("Ada invites Bo from her room through eqosys: it lands in his notes, and his lobby lists it as a link into her room", async () => {
  const ada = browser(), bo = browser();
  const a = await signIn(ada, "eq_ada"), b = await signIn(bo, "eq_bo");
  const id = roomId("Desert set", mulberry32(4));
  const link = inviteLink(SITE, id, LIVE_ROOM.id, "Desert set");
  const hubOf = (t: string) => hub({ url: () => EQ, token: () => t, app: APP });

  // her friends, the one in Qollab Studio now first
  const view = (await hubOf(a.login.token).state())!;
  expect(friendOrder(view.friends, APP).map((f) => [f.name, f.here])).toEqual([["Bo", true], ["Cy", false]]);
  expect(await hubOf(a.login.token).notify("u_bo", inviteNote("Desert set", LIVE_ROOM.name), link)).toBeNull();
  // someone who isn't her friend can't be sent one
  expect(await hubOf(a.login.token).notify("u_zed", inviteNote("Desert set", LIVE_ROOM.name), link)).toBe("only a friend can be notified");

  // Bo's lobby: one invite per room, newest first, rebuilt as a link on this site
  const older = inviteLink(SITE, "old-room-abcd", LIVE_ROOM.id, "Old");
  notes.u_bo!.unshift({ key: "n0", at: 0, kind: "note", from: { id: "u_ada", name: "Ada" }, app: APP, text: "hi", link: older },
    { key: "nx", at: 0, kind: "note", from: { id: "u_ada", name: "Ada" }, app: "another-app", text: "hi", link });
  const got = invitesIn((await hubOf(b.login.token).state())!.notes, APP, SITE);
  expect(got.map((i) => [i.from, i.name, i.room])).toEqual([["Ada", "Desert set", id], ["Ada", "Old", "old-room-abcd"]]);
  bo.address = got[0]!.link; use(bo);
  expect(fromLink(location.search)).toEqual({ room: id, studio: LIVE_ROOM.id, name: "Desert set" });
  const B = await walkIn(b.login.token, "d".repeat(32));
  expect(B.status).not.toBe(401);
});

test("Cy has no account yet: Ada's copied link names her on his door, and signing up brings him back into her room", async () => {
  const ada = browser(), cy = browser();
  await signIn(ada, "eq_ada");
  const id = roomId("Desert set", mulberry32(6));
  // the Invite button's link: the room, signed with who sent it
  cy.address = inviteLink(SITE, id, LIVE_ROOM.id, "Desert set", "Ada"); use(cy);
  const door = doorWords(fromLink(location.search), invitedBy(location.search));
  expect(door.invited).toBe("Ada invited you to Desert set.");
  expect(door.lead).toContain("New here?");
  // the bare door, and a link nobody signed, still read right
  expect(doorWords(null, null).button).toBe("Sign in with eqosys");
  expect(doorWords({ room: id, name: "" }, null).invited).toBe(`You're invited to ${id}.`);

  // eqosys made his account and sent him back: the same room, Ada's name still on the address, and he walks in
  const c = await signIn(cy, "eq_cy");
  expect(c.login.name).toBe("Cy");
  expect(fromLink(location.search)).toEqual({ room: id, studio: LIVE_ROOM.id, name: "Desert set" });
  expect(invitedBy(location.search)).toBe("Ada");
  expect((await walkIn(c.login.token, "e".repeat(32))).status).not.toBe(401);
});
