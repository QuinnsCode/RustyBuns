// The world's limits on a fake platform: sockets per room, messages per socket,
// and an online room left empty long enough is deleted (the desktop's never is).
import { expect, test, setSystemTime, afterEach, beforeAll, afterAll } from "bun:test";
import World, { CLOSE_FLOOD, CLOSE_FULL, MAX_SOCKETS, type WorldEnv } from "../packages/desktop/world.ts";
import Lobby from "../src/lobby.ts";
import { TRACKS } from "../src/engine/params.ts";

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
  expect(back.sent).toEqual([{ t: "snapshot", project: expect.objectContaining({ bpm: 140 }) }, { t: "floor", state: "closed", host: true }, { t: "peers", n: 1 }]);
  world.webSocketMessage(back, JSON.stringify({ t: "floor", state: "free" }));
  await settle();
  expect((await join({}, "c".repeat(32))).ws.closed).toBeNull();
});
