// The world's limits on a fake platform: sockets per room, messages per socket,
// and an online room left empty long enough is deleted (the desktop's never is).
import { expect, test, setSystemTime, afterEach, beforeAll, afterAll } from "bun:test";
import World, { CLOSE_FLOOD, CLOSE_FULL, MAX_SOCKETS, MAX_WRONG, type WorldEnv } from "../packages/desktop/world.ts";
import Lobby from "../src/lobby.ts";
import { TRACKS } from "../src/engine/params.ts";
import { TAKE_RATE, TakeInbox, toChunks } from "../src/take.ts";
import { decodeServer } from "../src/project.ts";
import { demoProject } from "../src/presets.ts";
import { LIVE_ROOM } from "../src/studio/rooms/live.ts";
import { body, gone, hear, keyNote, nearSpot, newJam, sit, snapshot, stand, walkTo } from "../src/studio/jam.ts";
import { randomAvatar, type Avatar } from "@rustybuns/util/avatar";
import { mulberry32 } from "@rustybuns/util";

class Sock {
  readyState = 1; sent: any[] = []; closed: number | null = null; att: unknown;
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close(code: number) { this.closed = code; this.readyState = 3; }
  serializeAttachment(v: unknown) { this.att = v; }
  deserializeAttachment() { return this.att; }
}
// Swapped in for these tests only: bun test runs every file in one process, so a fake left
// behind breaks later files that use the real ones (shell-bun's DO tests).
const FakePair = class { 0 = new Sock(); 1 = new Sock(); };
// Bun's Response refuses status 101; the world's reply shape is not what these tests check.
const RealResponse = Response;
const FakeResponse = class extends RealResponse {
  constructor(body: any, init?: any) { super(body, init?.status === 101 ? { status: 200 } : init); }
};
let realPair: unknown;
beforeAll(() => { realPair = (globalThis as any).WebSocketPair; (globalThis as any).WebSocketPair = FakePair; (globalThis as any).Response = FakeResponse; });
afterAll(() => { (globalThis as any).WebSocketPair = realPair; (globalThis as any).Response = RealResponse; });

function fakeStorage(store = new Map<string, unknown>()) {
  return {
    get: async (k: string) => store.get(k),
    put: async (k: string, v: unknown) => { store.set(k, structuredClone(v)); },
    delete: async (k: string) => store.delete(k),
    list: async <T,>(o: { prefix: string }) => new Map([...store].filter(([k]) => k.startsWith(o.prefix))) as Map<string, T>,
  };
}
/** The edge's Lobby and bucket, real Lobby on a fake platform, shared by every room built with it. */
async function edge(env: { MAX_ROOMS?: string; MAX_SESHES?: string } = {}) {
  const ctx = { storage: fakeStorage(), gate: Promise.resolve() as Promise<unknown>, blockConcurrencyWhile: (f: () => Promise<unknown>) => (ctx.gate = f()) };
  const lobby = new Lobby(ctx, env);
  await ctx.gate;
  const bucket = new Map<string, string>();
  const worldEnv: WorldEnv = {
    LOBBY: { idFromName: () => "lobby", get: () => ({ fetch: (url, init) => lobby.fetch(new Request(url, init)) }) },
    BACKUP: {
      get: async (k) => (bucket.has(k) ? { text: async () => bucket.get(k)! } : null),
      put: async (k, v) => { bucket.set(k, v); },
      delete: async (k) => { bucket.delete(k); },
    },
  };
  return { lobby, bucket, worldEnv };
}

async function setup(env: WorldEnv = {}, room = "") {
  const store = new Map<string, unknown>();
  const ctx = {
    sockets: [] as Sock[], alarmAt: null as number | null,
    storage: {
      get: async (k: string) => store.get(k),
      put: async (k: string, v: unknown) => { store.set(k, structuredClone(v)); },
      delete: async (k: string) => store.delete(k),
      setAlarm: async (at: number) => { ctx.alarmAt = at; },
      deleteAlarm: async () => { ctx.alarmAt = null; },
    },
    getWebSockets: () => ctx.sockets.filter((s) => s.readyState === 1),
    acceptWebSocket(s: Sock) { ctx.sockets.push(s); },
    gate: Promise.resolve() as Promise<unknown>,
    blockConcurrencyWhile: (f: () => Promise<unknown>) => (ctx.gate = f()),
  };
  const world = new World(ctx, env);
  await ctx.gate;                                                  // the platform holds events until the constructor is done
  const join = async (headers: Record<string, string> = {}, key = "") => {
    const r = await world.fetch(new Request(`http://x/ws${key ? `?key=${key}` : ""}`, { headers: { Upgrade: "websocket", "X-User-Id": "u", ...(room ? { "X-Room": room } : {}), ...headers } }));
    return { status: r.status, ws: ctx.sockets.at(-1)! };
  };
  const leave = (ws: Sock) => { ws.close(1000); world.webSocketClose(ws); };
  return { ctx, store, world, join, leave };
}
const project = { v: 1, bpm: 120, swing: 0, bars: 2, tracks: Array.from({ length: TRACKS }, () => ({ params: [], notes: [] })) };

afterEach(() => setSystemTime());
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test("a message that isn't an object is dropped, not thrown", async () => {
  const { world, join } = await setup();
  const { ws } = await join();
  for (const m of ["null", "7", "\"op\"", "[]"]) expect(() => world.webSocketMessage(ws, m)).not.toThrow();
  expect(ws.closed).toBeNull();
});

test("an edit is passed on to the others; one of the wrong shape goes nowhere", async () => {
  const { world, join } = await setup();
  const a = (await join()).ws, b = (await join()).ws;
  world.webSocketMessage(a, JSON.stringify({ t: "init", project }));
  b.sent = [];
  for (const op of [{ t: "param", track: TRACKS, i: 0, v: 0.5 }, { t: "param", track: 0, i: "0", v: 0.5 }, { t: "mute" }])
    world.webSocketMessage(a, JSON.stringify({ t: "op", op }));
  expect(b.sent).toEqual([]);
  world.webSocketMessage(a, JSON.stringify({ t: "op", op: { t: "track", track: 1, mute: true } }));
  expect(b.sent).toEqual([{ t: "op", op: { t: "track", track: 1, mute: true } }]);
});

test("a room past its seats tells the next one why and closes it", async () => {
  const { join } = await setup();
  for (let i = 0; i < MAX_SOCKETS; i++) expect((await join()).ws.closed).toBeNull();
  const { ws } = await join();
  expect(ws.sent).toEqual([{ t: "full", why: "room" }]);
  expect(ws.closed).toBe(CLOSE_FULL);
});

test("a jam: one player's hands reach the others, and letting go when they leave", async () => {
  const { world, join, leave } = await setup();
  const a = (await join()).ws, b = (await join()).ws, c = (await join()).ws;
  world.webSocketMessage(a, JSON.stringify({ t: "init", project }));
  b.sent = []; c.sent = []; a.sent = [];
  for (const e of [{ t: "on", track: 5, midi: 60, vel: 0.9 }, { t: "cursor", x: 0.5, y: 0.25 }, { t: "play" }, { t: "on", track: 99, midi: 60, vel: 1 }])
    world.webSocketMessage(a, JSON.stringify({ t: "live", e }));
  const from = b.sent[0]?.from;
  expect(from).toBeGreaterThan(0);
  const heard = [{ t: "live", from, e: { t: "on", track: 5, midi: 60, vel: 0.9 } }, { t: "live", from, e: { t: "cursor", x: 0.5, y: 0.25 } }, { t: "live", from, e: { t: "play" } }];
  expect(b.sent).toEqual(heard);                                  // in order, and the bad track went nowhere
  expect(c.sent).toEqual(heard);
  expect(a.sent).toEqual([]);                                     // not echoed back
  leave(a);
  expect(b.sent).toContainEqual({ t: "gone", from });
});

test("online: rooms past MAX_ROOMS get the sign-up list; a room that empties gives its slot back", async () => {
  const { lobby, worldEnv } = await edge({ MAX_ROOMS: "1" });
  const one = await setup(worldEnv, "fuzzy-black-panda"), two = await setup(worldEnv, "brave-teal-otter");
  const a = (await one.join()).ws;
  expect(a.closed).toBeNull();
  const b = (await two.join()).ws;
  expect(b.sent).toEqual([{ t: "full", why: "rooms" }]);
  expect(b.closed).toBe(CLOSE_FULL);
  const signup = (email: string) => lobby.fetch(new Request("https://lobby/signup", { method: "POST", body: JSON.stringify({ email, room: "brave-teal-otter" }) })).then((r) => r.json());
  expect(await signup("kid@example.com")).toEqual({ place: 1 });
  expect(await signup("KID@example.com")).toEqual({ place: 1 });  // once per address
  expect(await signup("not an email")).toEqual({ error: "an email address, please" });
  one.leave(a);
  await settle();
  expect((await two.join()).ws.closed).toBeNull();
});

test("online: a sesh whose Durable Object was reset gets its groove back from the bucket", async () => {
  const { bucket, worldEnv } = await edge();
  const first = await setup(worldEnv, "jolly-plum-yak");
  const a = (await first.join()).ws;
  first.world.webSocketMessage(a, JSON.stringify({ t: "init", project: { ...project, bpm: 172 } }));
  first.leave(a);
  await settle();
  expect(bucket.has("sesh/jolly-plum-yak.json")).toBe(true);
  const fresh = await setup(worldEnv, "jolly-plum-yak");        // same name, empty storage
  const { ws } = await fresh.join();
  expect(ws.sent[0]).toMatchObject({ t: "snapshot", project: { bpm: 172 } });
  // a copy from before the maker was kept is the project alone, and still comes back
  bucket.set("sesh/old-grey-owl.json", JSON.stringify({ ...project, bpm: 99 }));
  const old = await setup(worldEnv, "old-grey-owl");
  expect((await old.join()).ws.sent[0]).toMatchObject({ t: "snapshot", project: { bpm: 99 } });
});

test("online: a reset sesh keeps its maker and its closed floor", async () => {
  const { worldEnv } = await edge();
  const maker = "a".repeat(16), stranger = "b".repeat(16);
  const first = await setup(worldEnv, "shy-red-fox");
  const a = (await first.join({}, maker)).ws;
  first.world.webSocketMessage(a, JSON.stringify({ t: "init", project }));
  first.world.webSocketMessage(a, JSON.stringify({ t: "floor", state: "closed" }));
  await settle();
  first.leave(a);
  await settle();
  const fresh = await setup(worldEnv, "shy-red-fox");            // same name, empty storage
  const knock = (await fresh.join({}, stranger)).ws;               // the first key in after the reset doesn't take it
  expect(knock.sent).toEqual([{ t: "full", why: "closed" }]);
  expect(knock.closed).toBe(CLOSE_FULL);
  expect((await fresh.join({}, maker)).ws.sent).toContainEqual({ t: "floor", state: "closed", host: true });
});

test("online: the maker's code lets in only who brings it, survives a reset, and only the maker sets it", async () => {
  const { bucket, worldEnv } = await edge({ MAX_ROOMS: "1" });
  const room = await setup(worldEnv, "giddy-jade-newt");
  const MAKER = "c".repeat(32);
  const maker = (await room.join({}, MAKER)).ws, friend = (await room.join()).ws;
  room.world.webSocketMessage(maker, JSON.stringify({ t: "init", project }));
  expect(maker.sent).toContainEqual({ t: "lock", on: false });
  room.world.webSocketMessage(friend, JSON.stringify({ t: "lock", code: "mine-now" })); // not the maker: ignored
  room.world.webSocketMessage(maker, JSON.stringify({ t: "lock", code: "ab" }));        // too short: ignored
  room.world.webSocketMessage(maker, JSON.stringify({ t: "lock", code: "plum-42" }));
  await Bun.sleep(5);
  expect(friend.sent.filter((m) => m.t === "lock").at(-1)).toEqual({ t: "lock", on: true, code: "plum-42" });  // already in: gets the code
  const knock = async (headers: Record<string, string>) => (await room.join({ "CF-Connecting-IP": "1.2.3.4", ...headers })).ws;
  for (const [headers, why] of [[{}, "code"], [{ "X-Sesh-Code": "wrong" }, "code"]] as const) {
    const ws = await knock(headers);
    expect(ws.sent).toEqual([{ t: "full", why }]);
    expect(ws.closed).toBe(CLOSE_FULL);
  }
  expect((await knock({ "X-Sesh-Code": "plum-42" })).sent).toContainEqual({ t: "lock", on: true });
  for (let i = 1; i < MAX_WRONG; i++) await knock({ "X-Sesh-Code": "guess" + i });
  expect((await knock({ "X-Sesh-Code": "plum-42" })).sent).toEqual([{ t: "full", why: "tries" }]);  // no more checking for a minute
  expect((await room.join({}, MAKER)).ws.closed).toBeNull();                                         // the maker never needs it
  setSystemTime(new Date(Date.now() + 61_000));
  expect((await knock({ "X-Sesh-Code": "plum-42" })).closed).toBeNull();
  // everyone leaves, the Durable Object is reset: the code comes back with the groove, and only as a hash
  for (const ws of room.ctx.sockets.filter((w) => w.readyState === 1)) room.leave(ws);
  await settle();
  expect(bucket.get("sesh/giddy-jade-newt.json")).not.toContain("plum-42");
  const fresh = await setup(worldEnv, "giddy-jade-newt");
  expect((await fresh.join()).ws.sent).toEqual([{ t: "full", why: "code" }]);
  const back = (await fresh.join({}, MAKER)).ws;
  fresh.world.webSocketMessage(back, JSON.stringify({ t: "lock", code: "" }));           // public again
  await Bun.sleep(5);
  expect((await fresh.join()).ws.closed).toBeNull();
});

test("a socket over its message budget is closed; a big message costs more", async () => {
  const { world, join } = await setup();
  const { ws } = await join();
  world.webSocketMessage(ws, JSON.stringify({ t: "init", project }));
  const op = JSON.stringify({ t: "op", op: { t: "param", track: 0, i: 0, v: 0.5 } });
  for (let i = 0; i < 200; i++) world.webSocketMessage(ws, op);
  expect(ws.closed).toBeNull();                                   // a knob drag is fine
  const big = JSON.stringify({ t: "op", op: { t: "global" }, pad: "x".repeat(200 * 1024) });
  for (let i = 0; i < 10 && ws.closed === null; i++) world.webSocketMessage(ws, big);
  expect(ws.closed).toBe(CLOSE_FLOOD);
});

test("online, a room left empty past its idle time is deleted; a visit restarts the clock", async () => {
  const { ctx, store, world, join, leave } = await setup();
  const idle = { "X-Room-Idle-Ms": "1000" };
  setSystemTime(new Date(1_000_000));
  const a = (await join(idle)).ws;
  world.webSocketMessage(a, JSON.stringify({ t: "init", project }));
  leave(a);
  await settle();
  expect(store.get("project")).toBeTruthy();                      // saved on the way out
  expect(ctx.alarmAt).toBe(1_001_000);
  setSystemTime(new Date(1_000_500));
  const b = (await join(idle)).ws;
  setSystemTime(new Date(1_001_000));
  await world.alarm();                                            // someone is here: nothing goes
  expect(store.get("project")).toBeTruthy();
  leave(b);
  await settle();
  expect(ctx.alarmAt).toBe(1_002_000);
  setSystemTime(new Date(1_002_000));
  await world.alarm();
  expect(store.size).toBe(0);
  expect(ctx.alarmAt).toBeNull();
});

test("on the desktop (no idle time) the groove is never deleted", async () => {
  const { ctx, store, world, join, leave } = await setup();
  const a = (await join()).ws;
  world.webSocketMessage(a, JSON.stringify({ t: "init", project }));
  leave(a);
  await settle();
  expect(store.get("project")).toBeTruthy();
  expect(ctx.alarmAt).not.toBeNull();                             // only the save alarm
  setSystemTime(new Date(Date.now() + 365 * 86_400_000));
  await world.alarm();
  expect(store.get("project")).toBeTruthy();
});

test("chat: the sesh's maker deletes even when a guest says hello first, lines reach everyone, and it's kept", async () => {
  const { store, world, join } = await setup({}, "fuzzy-black-panda");
  const host = (await join({}, "a".repeat(32))).ws, guest = (await join({}, "b".repeat(32))).ws, lurker = (await join()).ws;
  const said = (ws: Sock, m: object) => world.webSocketMessage(ws, JSON.stringify(m));
  const tick = () => new Promise((r) => setTimeout(r, 5));        // hello hashes the key
  said(guest, { t: "hello", key: "b".repeat(48), name: "" });     // the guest's hello lands first
  await tick();
  said(host, { t: "hello", key: "a".repeat(48), name: "Ryan" });
  await tick();
  const me = host.sent.find((m) => m.t === "chat"), them = guest.sent.find((m) => m.t === "chat");
  expect(me.host).toBe(true);
  expect(them.host).toBe(false);
  expect(guest.sent).toContainEqual({ t: "named", who: me.you, name: "Ryan" });

  said(lurker, { t: "say", text: "no hello, no voice" });
  said(guest, { t: "say", text: "  hi \u0007there  " });
  said(guest, { t: "rename", name: "Sam" });
  await tick();
  const line = { id: 1, from: them.you, at: expect.any(Number), text: "hi  there" };
  expect(host.sent).toContainEqual({ t: "line", line });
  expect(lurker.sent).toContainEqual({ t: "line", line });       // listening is fine without a hello
  expect(host.sent).toContainEqual({ t: "named", who: them.you, name: "Sam" });

  said(guest, { t: "unsay", id: 1 });                             // not the maker: nothing happens
  await tick();
  expect(host.sent.some((m) => m.t === "unsaid")).toBe(false);
  said(host, { t: "unsay", id: 1 });
  await tick();
  expect(guest.sent).toContainEqual({ t: "unsaid", id: 1 });

  await world.alarm();
  expect(store.get("chat")).toMatchObject({ lines: [{ id: 1, from: them.you, text: "", deleted: true }], names: { [me.you]: "Ryan", [them.you]: "Sam" } });
});

test("online, the sesh's maker holds the floor, lets it go, and closes it out", async () => {
  const { world, join, leave } = await setup({}, "fuzzy-black-panda");
  const MAKER = "a".repeat(32), GUEST = "b".repeat(32);
  const maker = (await join({}, MAKER)).ws, guest = (await join({}, GUEST)).ws;
  expect(maker.sent).toContainEqual({ t: "floor", state: "free", host: true });   // first key in is the maker
  expect(guest.sent).toContainEqual({ t: "floor", state: "free", host: false });
  world.webSocketMessage(maker, JSON.stringify({ t: "init", project }));
  const edit = (ws: Sock, bpm: number) => world.webSocketMessage(ws, JSON.stringify({ t: "op", op: { t: "global", bpm } }));
  const note = (ws: Sock, t: "on" | "off") => world.webSocketMessage(ws, JSON.stringify({ t: "live", e: { t, track: 0, midi: 60, vel: 1 } }));

  // freezone: the guest edits and plays like anyone
  maker.sent = [];
  edit(guest, 130); note(guest, "on");
  expect(maker.sent.map((m) => m.t)).toEqual(["op", "live"]);

  // a guest can't take the floor; the maker's Esc does
  world.webSocketMessage(guest, JSON.stringify({ t: "floor", state: "held" }));
  world.webSocketMessage(maker, JSON.stringify({ t: "floor", state: "held" }));
  await settle();
  expect(guest.sent).toContainEqual({ t: "floor", state: "held", host: false });
  maker.sent = []; guest.sent = [];
  edit(guest, 90); note(guest, "on"); note(guest, "off");
  expect(maker.sent).toEqual([{ t: "live", from: expect.any(Number), e: { t: "off", track: 0, midi: 60 } }]);  // only letting go gets out
  expect(guest.sent).toEqual([{ t: "snapshot", project: expect.objectContaining({ bpm: 130 }) }]);             // and the guest is put back in step
  edit(maker, 100);
  expect(guest.sent.at(-1)).toEqual({ t: "op", op: { t: "global", bpm: 100 } });

  world.webSocketMessage(maker, JSON.stringify({ t: "floor", state: "free" }));
  await settle();
  maker.sent = [];
  edit(guest, 140);
  expect(maker.sent).toEqual([{ t: "op", op: { t: "global", bpm: 140 } }]);

  // close out: the guest is sent away and can't come back; the maker can, and reopens it
  world.webSocketMessage(maker, JSON.stringify({ t: "floor", state: "closed" }));
  await settle();
  expect(guest.sent).toContainEqual({ t: "full", why: "closed" });
  expect(guest.closed).toBe(CLOSE_FULL);
  const late = (await join({}, "c".repeat(32))).ws;
  expect(late.sent).toEqual([{ t: "full", why: "closed" }]);
  leave(maker);
  await settle();
  const back = (await join({}, MAKER)).ws;
  expect(back.sent).toEqual([{ t: "snapshot", project: expect.objectContaining({ bpm: 140 }) }, { t: "floor", state: "closed", host: true }, { t: "lock", on: false }, { t: "peers", n: 1 }]);
  world.webSocketMessage(back, JSON.stringify({ t: "floor", state: "free" }));
  await settle();
  expect((await join({}, "c".repeat(32))).ws.closed).toBeNull();
});

test("a recorded take: its sound reaches the room in chunks before it lands on a track, a late joiner gets it, a reset keeps it, and it goes when it's off every track", async () => {
  const { bucket, worldEnv } = await edge();
  const { world, join, leave } = await setup(worldEnv, "merry-rust-fox");
  const a = (await join()).ws, b = (await join()).ws;
  world.webSocketMessage(a, JSON.stringify({ t: "init", project }));
  const s16 = new Int16Array(3 * TAKE_RATE).map((_, i) => Math.round(8000 * Math.sin(i / 10)));
  const chunks = toChunks("take0001", s16);
  const place = (ws: Sock, id: string, track = 3) => world.webSocketMessage(ws, JSON.stringify({ t: "op", op: { t: "take", track, take: { id, beat: 2, frames: s16.length } } }));

  // a take whose sound isn't all here yet goes nowhere, and the player is put back in step
  b.sent = []; a.sent = [];
  world.webSocketMessage(a, JSON.stringify(chunks[0]));
  place(a, "take0001");
  expect(a.sent.map((m) => m.t)).toEqual(["snapshot"]);
  for (const c of chunks.slice(1)) world.webSocketMessage(a, JSON.stringify(c));
  place(a, "take0001");
  await settle();
  expect(b.sent.map((m) => m.t)).toEqual([...chunks.map(() => "takeBytes"), "op"]);
  const heard = new TakeInbox();
  expect(b.sent.filter((m) => m.t === "takeBytes").map((m) => heard.add(m)).at(-1)?.length).toBe(s16.length);

  // someone who comes in later gets the groove, then the take's sound
  const c = (await join()).ws;
  await settle();
  expect(c.sent.find((m) => m.t === "snapshot")?.project.tracks[3].take).toEqual({ id: "take0001", beat: 2, frames: s16.length });
  expect(c.sent.filter((m) => m.t === "takeBytes").map((m) => m.data)).toEqual(chunks.map((m) => m.data));
  for (const ws of [a, b, c]) leave(ws);
  await settle();

  // the Durable Object is reset: the groove and the take's sound come back from the bucket
  const fresh = await setup(worldEnv, "merry-rust-fox");
  const d = (await fresh.join()).ws;
  await settle();
  expect(d.sent.find((m) => m.t === "snapshot")?.project.tracks[3].take).toEqual({ id: "take0001", beat: 2, frames: s16.length });
  expect(d.sent.filter((m) => m.t === "takeBytes").map((m) => m.data)).toEqual(chunks.map((m) => m.data));

  // off the track, its sound stays for undo while anyone's in, and goes with the last one out, bucket copy too
  fresh.world.webSocketMessage(d, JSON.stringify({ t: "op", op: { t: "take", track: 3, take: null } }));
  expect(fresh.store.has("take:take0001:0")).toBe(true);
  fresh.leave(d);
  await settle();
  expect([...fresh.store.keys()].filter((k) => k.startsWith("take"))).toEqual([]);
  expect([...bucket.keys()].filter((k) => k.includes("/take/"))).toEqual([]);
});

test("studio: friends share one patch, two can't carry one amp, a held lead is in its player's hand, and it's kept", async () => {
  const { bucket, worldEnv } = await edge();
  const { world, join, leave, store } = await setup(worldEnv, "grand-amber-lynx");
  const a = (await join()).ws, b = (await join()).ws;
  const act = (ws: Sock, op: object) => world.webSocketMessage(ws, JSON.stringify({ t: "studio", op }));
  a.sent = []; b.sent = [];
  act(a, { t: "bring", id: "amp-1", gear: "q-amp", at: [0, 0, 1], turn: 0 });
  const from = b.sent[0]?.from;
  expect(b.sent).toEqual([{ t: "studio-op", from, op: { t: "bring", id: "amp-1", gear: "q-amp", at: [0, 0, 1], turn: 0 } }]);
  expect(a.sent).toEqual(b.sent);                                 // the world's word, to the one who did it too
  b.sent = [];
  act(b, { t: "pick", id: "amp-1" });                             // a has it: b is put back in step instead
  expect(b.sent).toEqual([{ t: "studio-all", studio: { patch: { placed: [{ id: "amp-1", gear: "q-amp", at: [0, 0, 1], turn: 0 }], cables: [], knobs: {} }, held: { [from]: { item: "amp-1" } } } }]);
  act(a, { t: "put", at: [2, 0, 3], turn: 1.5 });
  act(a, { t: "bring", id: "fuzz-1", gear: "fuzz", at: [1, 0, 1], turn: 0 });
  act(a, { t: "put", at: [1, 0, 1], turn: 0 });
  // a pulls a cable out of the pedal and walks the free end over: b sees it in a's hand
  b.sent = [];
  act(a, { t: "lead", from: ["fuzz-1", "out"] });
  world.webSocketMessage(a, JSON.stringify({ t: "live", e: { t: "body", at: [1.5, 1.7, 2], yaw: 0.3 } }));
  expect(b.sent).toEqual([{ t: "studio-op", from, op: { t: "lead", from: ["fuzz-1", "out"] } }, { t: "live", from, e: { t: "body", at: [1.5, 1.7, 2], yaw: 0.3 } }]);
  act(b, { t: "lead", from: ["fuzz-1", "out"] });                 // that jack's cable is in a's hand
  expect(b.sent.at(-1).t).toBe("studio-all");
  act(a, { t: "plug", to: ["amp-1", "in"] });
  act(b, { t: "knob", id: "amp-1", knob: "gain", v: 0.8 });
  act(b, { t: "knob", id: "amp-1", knob: "gain", v: 7 });         // off the dial: dropped
  act(b, { t: "lead", from: ["amp-1", "speaker-out"] });
  leave(b);                                                       // the lead falls out of b's hand
  await settle();
  const patch = {
    placed: [{ id: "amp-1", gear: "q-amp", at: [2, 0, 3], turn: 1.5 }, { id: "fuzz-1", gear: "fuzz", at: [1, 0, 1], turn: 0 }],
    cables: [{ from: ["fuzz-1", "out"], to: ["amp-1", "in"] }],
    knobs: { "amp-1": { gain: 0.8 } },
  };
  leave(a);
  await settle();
  expect(store.get("studio")).toEqual(patch);
  // the Durable Object is reset: the studio comes back from the bucket, nobody holding anything
  expect(JSON.parse(bucket.get("sesh/grand-amber-lynx.json")!).studio).toEqual(patch);
  const fresh = await setup(worldEnv, "grand-amber-lynx");
  expect((await fresh.join()).ws.sent).toContainEqual({ t: "studio-all", studio: { patch, held: {} } });
});

test("jam room: one walks up to the keys, sits and plays; the other sees them seated, gets the note, and can't take the seat", async () => {
  const { world, join, leave } = await setup({}, "giddy-jade-otter");
  const groove = demoProject();
  const a = (await join()).ws, b = (await join()).ws;
  world.webSocketMessage(a, JSON.stringify({ t: "init", project: groove }));
  const amy = newJam(LIVE_ROOM), ben = newJam(LIVE_ROOM);
  const from = (ws: Sock) => ws.sent.find((m) => m.t === "live")?.from;
  // each page reads its socket the way the page does: decoded, then handed to the jam
  const read = (ws: Sock, j: typeof amy) => { for (const m of ws.sent.splice(0)) { const d = decodeServer(m); if (d?.t === "live") hear(j, d.from, d.e); else if (d?.t === "gone") gone(j, d.from); } };
  const live = (ws: Sock, e: object) => world.webSocketMessage(ws, JSON.stringify({ t: "live", e }));
  a.sent = []; b.sent = [];
  const me: Avatar = randomAvatar(mulberry32(7));
  live(a, { t: "wear", avatar: me, name: "Amy" });
  const keys = LIVE_ROOM.spots.find((s) => s.id === "keys")!;
  expect(sit(amy, "keys")).toEqual({ ok: false, why: "Walk up to the keys first" });
  walkTo(amy, keys.at[0], keys.at[1] + 1);
  expect(nearSpot(amy)?.id).toBe("keys");
  expect(sit(amy, "keys")).toEqual({ ok: true });
  expect(amy.me.cam).toBe("first");
  live(a, body(amy));
  const note = keyNote(amy, groove, "KeyA")!;
  expect(groove.tracks[note.track].name).toBe("Keys");
  live(a, { t: "on", ...note, vel: 0.8 });
  const peer = from(b);
  read(b, ben);
  expect(snapshot(ben, groove).others).toEqual([{ peer, name: "Amy", at: [keys.at[0], keys.at[1]], yaw: 0, seat: "keys", dressed: true, playing: [`${note.track}:${note.midi}`] }]);
  // the keys are taken: Ben walks up and is told who's there
  walkTo(ben, keys.at[0] + 0.8, keys.at[1] + 0.8);
  expect(sit(ben, "keys")).toEqual({ ok: false, why: "Amy is at the keys" });
  // Amy stands: back over the shoulder, and the seat is free for Ben
  live(a, { t: "off", ...note });
  stand(amy);
  expect(amy.me.cam).toBe("shoulder");
  live(a, body(amy));
  read(b, ben);
  expect(sit(ben, "keys")).toEqual({ ok: true });
  leave(a);
  read(b, ben);
  expect(ben.others.size).toBe(0);
});

test("grants: the leader lets one play, another asks and is told No, an edit without a grant doesn't land, and a reset keeps them", async () => {
  const { bucket, worldEnv } = await edge();
  const room = "humble-jade-heron";
  const first = await setup(worldEnv, room);
  const said = (ws: Sock, m: object) => first.world.webSocketMessage(ws, JSON.stringify(m));
  const tick = () => new Promise((r) => setTimeout(r, 5));          // hello hashes the key
  const lead = (await first.join({}, "a".repeat(32))).ws, amy = (await first.join({}, "b".repeat(32))).ws, bo = (await first.join({}, "c".repeat(32))).ws;
  const ids: string[] = [];
  for (const [ws, k] of [[lead, "a"], [amy, "b"], [bo, "c"]] as const) {
    said(ws, { t: "hello", key: k.repeat(48), name: "" });
    await tick();
    ids.push(ws.sent.find((m) => m.t === "chat").you);
  }
  const [leadId, amyId, boId] = ids;
  const lastGrants = (ws: Sock) => ws.sent.filter((m) => m.t === "grants").at(-1);
  expect(lastGrants(bo)).toEqual({ t: "grants", grants: { who: {}, maker: leadId }, asks: {}, here: [leadId, amyId, boId] });
  said(lead, { t: "init", project });
  said(lead, { t: "floor", state: "held" });                       // Hold: only the leader, until they grant
  await settle();

  // the leader grants Amy play; only the leader may grant
  said(bo, { t: "grant", who: boId, can: ["play", "edit"] });
  said(lead, { t: "grant", who: amyId, can: ["play"] });
  await settle();
  expect(lastGrants(bo).grants.who).toEqual({ [amyId]: ["play"] });
  amy.sent = []; bo.sent = [];
  const note = { t: "on", track: 0, midi: 60, vel: 0.8 };
  said(amy, { t: "live", e: note });
  said(bo, { t: "live", e: note });
  expect(bo.sent).toContainEqual({ t: "live", from: expect.any(Number), e: note });   // Amy is heard
  expect(amy.sent.some((m) => m.t === "live")).toBe(false);                          // Bo is not

  // Bo raises a hand to edit; the leader sees it and says No
  said(bo, { t: "ask", can: "edit" });
  await settle();
  expect(lastGrants(lead).asks).toEqual({ [boId]: "edit" });
  said(lead, { t: "answer", who: boId, yes: false });
  await settle();
  expect(lastGrants(bo)).toMatchObject({ asks: {}, grants: { who: { [amyId]: ["play"] } } });

  // an edit without the grant doesn't land: nobody hears it and its sender is put back in step; Amy's play grant isn't edit either
  amy.sent = []; bo.sent = []; lead.sent = [];
  said(bo, { t: "op", op: { t: "global", bpm: 90 } });
  said(amy, { t: "op", op: { t: "notes", track: 0, notes: [{ s: 0, l: 1, m: 60, v: 1 }] } });
  expect(lead.sent).toEqual([]);
  expect(bo.sent).toEqual([{ t: "snapshot", project: expect.objectContaining({ bpm: 120 }) }]);
  // Yes to a hand grants what it asked for, on top of what they had
  said(amy, { t: "ask", can: "mix" });
  said(lead, { t: "answer", who: amyId, yes: true });
  await settle();
  said(amy, { t: "op", op: { t: "track", track: 1, mute: true } });
  expect(lead.sent).toContainEqual({ t: "op", op: { t: "track", track: 1, mute: true } });

  // the grants go to the bucket with the groove and come back after a reset
  for (const ws of [amy, bo, lead]) first.leave(ws);
  await settle();
  expect(JSON.parse(bucket.get(`sesh/${room}.json`)!).grants).toEqual({ who: { [amyId]: ["play", "mix"] }, maker: leadId });
  const fresh = await setup(worldEnv, room);
  const back = (await fresh.join({}, "c".repeat(32))).ws;
  fresh.world.webSocketMessage(back, JSON.stringify({ t: "hello", key: "c".repeat(48), name: "" }));
  await tick();
  expect(lastGrants(back)).toMatchObject({ grants: { who: { [amyId]: ["play", "mix"] }, maker: leadId }, here: [boId] });
  back.sent = [];
  fresh.world.webSocketMessage(back, JSON.stringify({ t: "op", op: { t: "global", bpm: 90 } }));
  expect(back.sent).toEqual([{ t: "snapshot", project: expect.objectContaining({ bpm: 120 }) }]);
});

test("wind back: play a while, hear it 5 minutes back alone, the leader brings everyone back, undo, and a reset keeps the ladder", async () => {
  const { bucket, worldEnv } = await edge();
  const room = "mellow-teal-otter", MAKER = "a".repeat(32);
  const t0 = Date.UTC(2026, 10, 16, 20, 0, 0);
  setSystemTime(new Date(t0));
  const { world, join, leave } = await setup(worldEnv, room);
  const maker = (await join({}, MAKER)).ws, guest = (await join({}, "b".repeat(32))).ws;
  const send = (ws: Sock, m: unknown) => world.webSocketMessage(ws, JSON.stringify(m));
  send(maker, { t: "init", project: { ...project, bpm: 100 } });
  // a twelve-minute jam: the guest moves the tempo once a minute
  for (let m = 1; m <= 12; m++) { setSystemTime(new Date(t0 + m * 60_000 + 10_000)); send(guest, { t: "op", op: { t: "global", bpm: 100 + m } }); }
  await settle();

  setSystemTime(new Date(t0 + 12.5 * 60_000));
  maker.sent = []; guest.sent = [];
  send(guest, { t: "rewind", ago: 5 });
  await settle();
  // 5 minutes back is 7:30: the groove as minute 7 began, after the tempo move of minute 6; sent to no one else
  expect(guest.sent).toEqual([{ t: "rewound", ago: 5, at: t0 + 7 * 60_000, project: expect.objectContaining({ bpm: 106 }) }]);
  expect(maker.sent).toEqual([]);
  const back = guest.sent[0].project;

  // the leader brings everyone back there (an edit), then undoes it (an edit back)
  send(maker, { t: "op", op: { t: "replace", project: back } });
  expect(guest.sent.at(-1)).toMatchObject({ t: "op", op: { t: "replace", project: { bpm: 106 } } });
  send(maker, { t: "op", op: { t: "replace", project: { ...back, bpm: 112 } } });
  expect(guest.sent.at(-1)).toMatchObject({ t: "op", op: { t: "replace", project: { bpm: 112 } } });

  send(guest, { t: "rewind", ago: 1440 });
  await settle();
  expect(guest.sent.at(-1)).toMatchObject({ t: "rewound", ago: 1440, project: null });    // the sesh isn't a day old

  // everyone leaves, the Durable Object is reset: the ladder comes back from the bucket with the groove
  leave(maker); leave(guest);
  await settle();
  expect(JSON.parse(bucket.get(`sesh/${room}.json`)!).ladder.snaps.length).toBeGreaterThan(5);
  const fresh = await setup(worldEnv, room);
  const again = (await fresh.join()).ws;
  fresh.world.webSocketMessage(again, JSON.stringify({ t: "rewind", ago: 5 }));
  await settle();
  expect(again.sent.at(-1)).toMatchObject({ t: "rewound", ago: 5, at: t0 + 7 * 60_000, project: { bpm: 106 } });
});
