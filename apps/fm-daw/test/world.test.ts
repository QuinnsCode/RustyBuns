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
import { keysReach } from "../src/studio/room.ts";
import { figure, handsOn, type Figure } from "../src/studio/figure.ts";
import * as THREE from "three";
import { BOOM, body, cameraPose, gone, hear, keyNote, nearSpot, newJam, sit, snapshot, stand, toggleCam, walkTo } from "../src/studio/jam.ts";
import { randomAvatar, type Avatar } from "@rustybuns/util/avatar";
import { mulberry32 } from "@rustybuns/util";
import { remotePlayer, studioTools } from "../src/studio/agent.ts";
import { mcpAnswer } from "../src/studio/mcp.ts";
import { roomWith } from "../src/studio/instrument.ts";
import { facing, mutePeer, muteRoom, noMutes, sounds } from "../src/studio/mute.ts";
import { handsUp, marks, words } from "../src/studio/hands.ts";
import { decodeGrantServer } from "../src/grants.ts";
import { apply, type Project } from "../src/project.ts";

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
  // Amy walks in seeing herself from behind, and in the back corner the camera comes in off the wall, not through it
  const walkIn = cameraPose(amy);
  expect(walkIn.boom).toBeGreaterThan(1.5);
  expect(walkIn.head).toBeGreaterThan(0.9);
  walkTo(amy, 4.2, 4.1);
  amy.me.yaw = 0;   // facing into the room, the back wall right behind her
  const corner = cameraPose(amy);
  expect(corner.boom).toBeLessThan(BOOM);
  expect(Math.max(Math.abs(corner.at[0]) - LIVE_ROOM.size.w / 2, Math.abs(corner.at[2]) - LIVE_ROOM.size.d / 2)).toBeLessThan(0);
  expect(sit(amy, "keys")).toEqual({ ok: false, why: "Walk up to the keys first" });
  walkTo(amy, keys.at[0], keys.at[1] + 1);
  expect(nearSpot(amy)?.id).toBe("keys");
  expect(sit(amy, "keys")).toEqual({ ok: true });
  expect(amy.me.cam).toBe("first");
  // first person, seated: her eyes sit back over the seat and look down at where her hands play, not across the keys
  const hands = [keys.at[0], 0.9, keys.at[1] - 0.5], eyes = cameraPose(amy);
  expect(eyes.at[2]).toBeGreaterThan(keys.at[1]);
  expect(Math.abs(eyes.pitch - Math.atan2(hands[1] - eyes.at[1], eyes.at[2] - hands[2]))).toBeLessThan(0.1);
  // V, seated: the camera goes up beside her shoulder, not behind her head, and looks down at her hands on the keys,
  // past her own head, hidden so it doesn't hide them
  toggleCam(amy);
  const over = cameraPose(amy);
  expect(Math.abs(over.at[0] - keys.at[0])).toBeGreaterThan(0.3);
  expect(over.head).toBe(0);
  // close in, at about her ear, so her hands and the keys fill the frame
  expect(Math.hypot(over.at[0] - amy.me.x, over.at[2] - amy.me.z)).toBeLessThan(0.7);
  expect(over.at[1]).toBeLessThan(1.8);
  const toHands = Math.atan2(hands[1] - over.at[1], Math.hypot(hands[0] - over.at[0], hands[2] - over.at[2]));
  expect(Math.abs(over.pitch - toHands)).toBeLessThan(0.25);
  expect(Math.abs(Math.atan2(-(hands[0] - over.at[0]), -(hands[2] - over.at[2])) - over.yaw)).toBeLessThan(0.3);
  toggleCam(amy);
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

test("jam room: whoever sits at the keys has their palms on the keys, short arms or long, and the drummer holds sticks", () => {
  const keys = LIVE_ROOM.spots.find((s) => s.id === "keys")!, reach = keysReach(keys)!;
  const palms = (fig: Figure) => {
    const out: THREE.Vector3[] = [];
    fig.group.updateMatrixWorld(true);
    fig.group.traverse((o) => { if (o.name === "hand") out.push(fig.group.worldToLocal(o.getWorldPosition(new THREE.Vector3()))); });
    return out;
  };
  for (let seed = 1; seed <= 12; seed++) {
    const fig = figure(randomAvatar(mulberry32(seed)), null);
    fig.pose({ speed: 0, seated: true, play: handsOn("keys", false), note: false, t: 1, reach });
    for (const p of palms(fig)) {
      expect(Math.abs(-p.z - reach.ahead)).toBeLessThan(0.04);
      expect(Math.abs(p.y - reach.up)).toBeLessThan(0.04);
    }
    // at the kit: a stick in each hand, and its hands come up only to strike
    fig.pose({ speed: 0, seated: true, play: handsOn("drums", false), note: false, t: 1, sticks: true });
    const sticks: THREE.Object3D[] = [];
    fig.group.traverse((o) => { if (o.parent?.name === "hand" && o instanceof THREE.Mesh && o.visible && o.geometry instanceof THREE.CylinderGeometry) sticks.push(o); });
    expect(sticks.length).toBe(2);
    expect(handsOn("drums", true)).toBe("sticks");
    fig.dispose();
  }
});

test("grants: the leader lets one play, another plays one track only, another asks and is told No, an edit without a grant doesn't land, and a reset keeps them", async () => {
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
  expect(lastGrants(bo)).toEqual({ t: "grants", grants: { who: {}, maker: leadId }, asks: {}, here: [leadId, amyId, boId], peers: expect.any(Object) });
  expect(Object.values(lastGrants(bo).peers).sort()).toEqual([leadId, amyId, boId].sort());   // each live-line peer's person
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

  // the leader lets Bo play track 3 only: his note there is heard, one on Amy's track 1 isn't; then back to the floor's
  said(lead, { t: "grant", who: boId, can: [], tracks: [2] });
  await settle();
  expect(lastGrants(bo).grants.tracks).toEqual({ [boId]: [2] });
  amy.sent = [];
  said(bo, { t: "live", e: note });
  said(bo, { t: "live", e: { ...note, track: 2 } });
  expect(amy.sent.filter((m) => m.t === "live").map((m) => m.e.track)).toEqual([2]);
  said(lead, { t: "grant", who: boId, can: null });
  await settle();
  expect(lastGrants(bo).grants.tracks).toBeUndefined();
  amy.sent = []; bo.sent = [];

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

test("mute: Amy mutes Bo for herself and Cy still hears him; the leader mutes Bo for everyone and he's told", async () => {
  const { bucket, worldEnv } = await edge();
  const room = "quiet-jade-wren";
  const { world, join, leave } = await setup(worldEnv, room);
  const said = (ws: Sock, m: object) => world.webSocketMessage(ws, JSON.stringify(m));
  const tick = () => new Promise((r) => setTimeout(r, 5));
  // Amy made the room, so she leads; Bo and Cy came in from her link
  const people = [];
  for (const [k, name] of [["a", "Amy"], ["b", "Bo"], ["c", "Cy"]] as const) {
    const ws = (await join({}, k.repeat(32))).ws;
    said(ws, { t: "hello", key: k.repeat(48), name });
    await tick();
    people.push({ ws, id: ws.sent.find((m) => m.t === "chat").you as string, jam: newJam(LIVE_ROOM), mutes: noMutes(), heard: [] as string[] });
  }
  const [amy, bo, cy] = people;
  said(amy.ws, { t: "init", project: demoProject() });
  await settle();
  // each page reads its socket as the page does: the jam hears everything, the speakers only what the mutes let through
  const read = (p: typeof amy) => {
    for (const m of p.ws.sent.splice(0)) {
      const d = decodeServer(m);
      if (d?.t !== "live") continue;
      hear(p.jam, d.from, d.e);
      if (d.e.t === "on" && sounds(p.mutes, d.from, d.e)) p.heard.push(`${d.from}:${d.e.midi}`);
    }
  };
  const live = (p: typeof amy, e: object) => said(p.ws, { t: "live", e });
  const peers = Object.entries(amy.ws.sent.findLast((m) => m.t === "grants").peers);
  const peerOf = (p: typeof amy) => Number(peers.find(([, id]) => id === p.id)![0]);
  const boPeer = peerOf(bo);
  for (const p of people) { p.ws.sent = []; live(p, { t: "wear", avatar: randomAvatar(mulberry32(1)), name: "x" }); }
  for (const p of people) read(p);

  // Bo stands where Amy is looking and holds a note; she looks at him and mutes him, and the note he holds lets go for her
  live(bo, { t: "body", at: [0, 0, -3], yaw: 0 });
  live(bo, { t: "on", track: 1, midi: 60, vel: 0.8 });
  for (const p of people) read(p);
  amy.jam.me.x = 0; amy.jam.me.z = 0; amy.jam.me.yaw = 0;
  expect(facing(amy.jam)).toBe(boPeer);
  expect(mutePeer(amy.mutes, amy.jam, boPeer)).toEqual([{ track: 1, midi: 60 }]);
  // his next note doesn't sound for Amy, and still does for Cy
  live(bo, { t: "on", track: 1, midi: 62, vel: 0.8 });
  for (const p of people) read(p);
  expect(amy.heard).toEqual([`${boPeer}:60`]);
  expect(cy.heard).toEqual([`${boPeer}:60`, `${boPeer}:62`]);
  // Cy mutes the whole room: nobody sounds for him, his own playing aside (that never goes through the line)
  expect(muteRoom(cy.mutes, cy.jam)).toEqual([{ track: 1, midi: 60 }, { track: 1, midi: 62 }]);
  live(amy, { t: "on", track: 2, midi: 48, vel: 0.8 });
  for (const p of people) read(p);
  expect(cy.heard).toHaveLength(2);
  expect(bo.heard).toEqual([`${peerOf(amy)}:48`]);
  muteRoom(cy.mutes, cy.jam, false);

  // only the leader mutes for everyone: Cy can't, Amy can, and Bo's grants say he's muted
  said(cy.ws, { t: "mute", who: bo.id, on: true });
  await settle();
  expect(bo.ws.sent.findLast((m) => m.t === "grants")?.grants.muted).toBeUndefined();
  said(amy.ws, { t: "mute", who: bo.id, on: true });
  await settle();
  expect(bo.ws.sent.findLast((m) => m.t === "grants").grants.muted).toEqual([bo.id]);
  // the World passes on none of his notes now, but he still moves; letting go still goes through so nothing hangs
  for (const p of people) p.ws.sent = [];
  live(bo, { t: "on", track: 1, midi: 64, vel: 0.8 });
  live(bo, { t: "off", track: 1, midi: 62 });
  live(bo, { t: "body", at: [1, 0, -3], yaw: 0 });
  expect(cy.ws.sent.map((m) => m.e.t)).toEqual(["off", "body"]);
  // it is kept with the grants, so a reset doesn't let him back in unheard
  for (const p of people) leave(p.ws);
  await settle();
  expect(JSON.parse(bucket.get(`sesh/${room}.json`)!).grants.muted).toEqual([bo.id]);
});

test("hands in the jam room: on a held floor Bo is listen only, raises his hand, Amy sees it and says Yes, and he plays", async () => {
  const { worldEnv } = await edge();
  const { world, join } = await setup(worldEnv, "steady-jade-lark");
  const said = (ws: Sock, m: object) => world.webSocketMessage(ws, JSON.stringify(m));
  const people = [];
  for (const k of ["a", "b"]) {
    const ws = (await join({}, k.repeat(32))).ws;
    said(ws, { t: "hello", key: k.repeat(48), name: "" });
    await new Promise((r) => setTimeout(r, 5));
    people.push({ ws, id: ws.sent.find((m) => m.t === "chat").you as string });
  }
  const [amy, bo] = people;
  said(amy.ws, { t: "init", project: demoProject() });
  said(amy.ws, { t: "floor", state: "held" });
  await settle();
  // what each page shows, read from its socket as the page reads it
  const grants = (p: typeof amy) => decodeGrantServer(p.ws.sent.findLast((m) => m.t === "grants"));
  const shows = (p: typeof amy, of: typeof amy) => words(marks(grants(p), "held", of.id));
  expect(shows(bo, bo)).toEqual(["Listen only"]);
  expect(shows(bo, amy)).toEqual(["Leads"]);
  // his note goes nowhere; he raises his hand, and Amy sees it over him and in her list
  amy.ws.sent = [];
  said(bo.ws, { t: "live", e: { t: "on", track: 0, midi: 60, vel: 0.8 } });
  expect(amy.ws.sent.some((m) => m.t === "live")).toBe(false);
  said(bo.ws, { t: "ask", can: "play" });
  await settle();
  expect(handsUp(grants(amy))).toEqual([bo.id]);
  expect(shows(amy, bo)).toEqual(["Hand up to play", "Listen only"]);
  // Yes: the hand comes down, he may play, and Amy hears him
  said(amy.ws, { t: "answer", who: bo.id, yes: true });
  await settle();
  expect(handsUp(grants(amy))).toEqual([]);
  expect(shows(bo, bo)).toEqual([]);
  amy.ws.sent = [];
  said(bo.ws, { t: "live", e: { t: "on", track: 0, midi: 60, vel: 0.8 } });
  expect(amy.ws.sent).toContainEqual({ t: "live", from: expect.any(Number), e: { t: "on", track: 0, midi: 60, vel: 0.8 } });
});

test("wind back: play a while, hear it 5 minutes back alone, whoever holds Lead brings everyone back, undo, and the ladder keeps its takes through an empty room and a reset", async () => {
  const { bucket, worldEnv } = await edge();
  const room = "mellow-teal-otter", MAKER = "a".repeat(32);
  const t0 = Date.UTC(2026, 10, 16, 20, 0, 0);
  setSystemTime(new Date(t0));
  const { world, join, leave, store } = await setup(worldEnv, room);
  const maker = (await join({}, MAKER)).ws, guest = (await join({}, "b".repeat(32))).ws;
  const send = (ws: Sock, m: unknown) => world.webSocketMessage(ws, JSON.stringify(m));
  for (const [ws, k] of [[maker, "a"], [guest, "b"]] as const) send(ws, { t: "hello", key: k.repeat(48), name: "" });
  await new Promise((r) => setTimeout(r, 5));                     // hello hashes the key
  const guestId = guest.sent.find((m) => m.t === "chat").you;
  send(maker, { t: "init", project: { ...project, bpm: 100 } });
  const s16 = new Int16Array(TAKE_RATE).map((_, i) => Math.round(8000 * Math.sin(i / 10)));
  const chunks = toChunks("take0001", s16);
  // a twelve-minute jam: the guest moves the tempo once a minute, records a take in minute 2 and takes it off in minute 9
  for (let m = 1; m <= 12; m++) {
    setSystemTime(new Date(t0 + m * 60_000 + 10_000));
    send(guest, { t: "op", op: { t: "global", bpm: 100 + m } });
    if (m === 2) { for (const c of chunks) send(guest, c); send(guest, { t: "op", op: { t: "take", track: 3, take: { id: "take0001", beat: 0, frames: s16.length } } }); }
    if (m === 9) send(guest, { t: "op", op: { t: "take", track: 3, take: null } });
  }
  await settle();

  // the maker holds the floor and hands the guest Lead
  send(maker, { t: "floor", state: "held" });
  send(maker, { t: "grant", who: guestId, can: ["lead"] });
  await settle();

  setSystemTime(new Date(t0 + 12.5 * 60_000));
  maker.sent = []; guest.sent = [];
  send(guest, { t: "rewind", ago: 5 });
  await settle();
  // 5 minutes back is 7:30: the groove as minute 7 began, after the tempo move of minute 6, with the take and its sound; sent to no one else
  expect(guest.sent.filter((m) => m.t !== "takeBytes")).toEqual([{ t: "rewound", ago: 5, at: t0 + 7 * 60_000, project: expect.objectContaining({ bpm: 106 }) }]);
  expect(guest.sent.filter((m) => m.t === "takeBytes").map((m) => m.data)).toEqual(chunks.map((m) => m.data));
  expect(maker.sent).toEqual([]);
  const back = guest.sent[0].project;
  expect(back.tracks[3].take.id).toBe("take0001");

  // the guest leads now: they bring everyone back there (an edit), then undo it (an edit back)
  send(guest, { t: "op", op: { t: "replace", project: back } });
  expect(maker.sent.at(-1)).toMatchObject({ t: "op", op: { t: "replace", project: { bpm: 106 } } });
  send(guest, { t: "op", op: { t: "replace", project: { ...apply(back, { t: "take", track: 3, take: null }), bpm: 112 } } });
  expect(maker.sent.at(-1)).toMatchObject({ t: "op", op: { t: "replace", project: { bpm: 112 } } });

  send(guest, { t: "rewind", ago: 1440 });
  await settle();
  expect(guest.sent.at(-1)).toMatchObject({ t: "rewound", ago: 1440, project: null });    // the sesh isn't a day old

  // everyone leaves: the take is on no track, but the ladder still has it, so its sound stays
  leave(maker); leave(guest);
  await settle();
  expect(store.has("take:take0001:0")).toBe(true);
  expect(JSON.parse(bucket.get(`sesh/${room}.json`)!).ladder.snaps.length).toBeGreaterThan(5);
  // the Durable Object is reset: the ladder and its take come back from the bucket with the groove
  const fresh = await setup(worldEnv, room);
  const again = (await fresh.join()).ws;
  fresh.world.webSocketMessage(again, JSON.stringify({ t: "rewind", ago: 5 }));
  await settle();
  expect(again.sent.findLast((m) => m.t === "rewound")).toMatchObject({ ago: 5, at: t0 + 7 * 60_000, project: { bpm: 106 } });
  expect(again.sent.filter((m) => m.t === "takeBytes").map((m) => m.data)).toEqual(chunks.map((m) => m.data));
});

test("jam room agent: no grant, it raises its hand; the leader says yes, and it makes an instrument over MCP, sits at it and plays for her", async () => {
  const { world, join } = await setup({}, "giddy-jade-otter");
  const tick = () => new Promise((r) => setTimeout(r, 5));        // the chat's hello hashes a key
  const amyWs = (await join({}, "a".repeat(32))).ws;              // first key in: Amy leads the sesh
  world.webSocketMessage(amyWs, JSON.stringify({ t: "init", project: demoProject() }));
  const botWs = (await join()).ws;
  const bot = remotePlayer({ base: LIVE_ROOM, name: "Bot", avatar: randomAvatar(mulberry32(3)), wait: async () => {},
    send: (m) => world.webSocketMessage(botWs, JSON.stringify(m)) });
  const pump = () => { for (const m of botWs.sent.splice(0)) bot.hear(m); };
  pump();
  const tools = studioTools(bot.player);
  const call = async (name: string, args: object = {}) => {
    const r = await mcpAnswer(tools, { id: 1, method: "tools/call", params: { name, arguments: args } });
    pump();
    return JSON.parse((r as { result: { content: { text: string }[] } }).result.content[0].text);
  };
  // Amy's page: the groove, the room with what's made in it, and the people in it, from her socket
  let groove: Project = demoProject();
  const amy = newJam(LIVE_ROOM), notes: { track: number; midi: number }[] = [];
  const read = () => {
    for (const m of amyWs.sent.splice(0)) {
      const d = decodeServer(m);
      if (d?.t === "op") { groove = apply(groove, d.op); amy.def = roomWith(LIVE_ROOM, groove); }
      if (d?.t === "live") { hear(amy, d.from, d.e); if (d.e.t === "on") notes.push({ track: d.e.track, midi: d.e.midi }); }
    }
  };
  const glass = { name: "Glass pad", voice: "analog", patch: { sound: "Reese", cutoff: 0.4 } };

  const answer = async (can: string) => {
    const hand = amyWs.sent.findLast((m) => m.t === "grants" && Object.values(m.asks).includes(can));
    const who = Object.keys(hand.asks).find((k) => hand.asks[k] === can)!;
    world.webSocketMessage(amyWs, JSON.stringify({ t: "answer", who, yes: true }));
    await tick();
    pump();
  };

  // Amy holds the floor: the bot may only listen, so it raises its hand to change the groove, and she says yes
  world.webSocketMessage(amyWs, JSON.stringify({ t: "hello", key: "a".repeat(48), name: "Amy" }));
  world.webSocketMessage(amyWs, JSON.stringify({ t: "floor", state: "held" }));
  await tick();
  pump();
  expect(await call("studio_make_instrument", glass)).toMatchObject({ ok: false, why: expect.stringContaining("raises your hand") });
  expect(await call("studio_ask_to_play", { can: "edit" })).toMatchObject({ asked: "edit" });
  await tick();
  await answer("edit");
  expect((await call("studio_state")).you.may).toEqual({ play: false, edit: true, mix: false, lead: false });

  // the bot makes a synth, and Amy's room grows a seat at its track with the patch on it
  read();
  const made = await call("studio_make_instrument", glass);
  expect(made).toMatchObject({ ok: true, spot: "made-glass-pad", name: "Glass pad", voice: "analog" });
  read();
  const seat = amy.def.spots.find((s) => s.id === "made-glass-pad")!;
  expect(groove.tracks[made.track]).toMatchObject({ name: "Glass pad", notes: [] });
  expect(seat.made?.voice).toBe("analog");
  // it sits there, but playing is a grant of its own: it asks again, and she lets it
  expect(await call("studio_sit", { spot: "made-glass-pad" })).toMatchObject({ ok: true, at: "Glass pad" });
  expect(await call("studio_play", { notes: [{ n: 48 }] })).toMatchObject({ ok: false });
  await call("studio_ask_to_play");
  await tick();
  await answer("play");
  read();
  // two notes: Amy sees it seated there and gets them on that track
  expect(await call("studio_play", { notes: [{ n: 48, len: 1 }, { n: 55, at: 1, len: 1 }] })).toMatchObject({ ok: true, played: 2, track: "Glass pad" });
  read();
  expect(notes).toEqual([{ track: made.track, midi: 48 }, { track: made.track, midi: 55 }]);
  expect(snapshot(amy, groove).others).toEqual([expect.objectContaining({ name: "Bot", seat: "made-glass-pad", dressed: true, playing: [] })]);
  // and the seat is taken for a person now, the same as any other
  amy.me.x = seat.at[0]; amy.me.z = seat.at[1] + 0.5;
  expect(sit(amy, "made-glass-pad")).toEqual({ ok: false, why: "Bot is at Glass pad" });
});

test("a guitar call: its setup goes to the one person it names, and a listen-only guest may ask for one but not send their own", async () => {
  const { world, join } = await setup({}, "fuzzy-black-panda");
  const maker = (await join({}, "a".repeat(32))).ws, guest = (await join({}, "b".repeat(32))).ws, third = (await join({}, "c".repeat(32))).ws;
  world.webSocketMessage(maker, JSON.stringify({ t: "init", project }));
  const all = [maker, guest, third], clear = () => { for (const s of all) s.sent = []; };
  const say = (ws: Sock, m: unknown) => world.webSocketMessage(ws, JSON.stringify(m));
  const peerOf = (ws: Sock) => { clear(); say(ws, { t: "live", e: { t: "cursor", x: 0, y: 0 } }); return all.find((o) => o !== ws)!.sent[0].from as number; };
  const M = peerOf(maker), G = peerOf(guest);
  const offer = { k: "sdp", type: "offer", sdp: "v=0\r\na=rtpmap:111 opus/48000/2\r\n" };

  clear();
  say(maker, { t: "rtc", to: G, line: "out", s: offer });
  say(guest, { t: "rtc", to: M, line: "in", s: { k: "ice", candidate: "candidate:1 1 udp 1 10.0.0.2 5000 typ host", mid: "0", index: 0 } });
  expect(guest.sent).toEqual([{ t: "rtc", from: M, line: "out", s: offer }]);
  expect(maker.sent).toEqual([{ t: "rtc", from: G, line: "in", s: { k: "ice", candidate: "candidate:1 1 udp 1 10.0.0.2 5000 typ host", mid: "0", index: 0 } }]);
  expect(third.sent).toEqual([]);                                    // nobody else sees the call's setup

  clear();
  for (const m of [{ t: "rtc", to: M, line: "out", s: offer }, { t: "rtc", to: G, line: "out", s: { k: "hello" } }, { t: "rtc", to: G, line: "sideways", s: offer },
    { t: "rtc", line: "out", s: offer }, { t: "rtc", to: G, line: "out", s: { ...offer, sdp: "x".repeat(20_000) } }]) say(maker, m);
  expect(all.map((s) => s.sent)).toEqual([[], [], []]);              // to yourself, or the wrong shape: nowhere

  // plugging in is said on the live line, to everyone
  say(maker, { t: "live", e: { t: "guitar", track: 2 } });
  expect(guest.sent).toEqual([{ t: "live", from: M, e: { t: "guitar", track: 2 } }]);

  // held: the guest still asks to hear the maker's guitar, but their own goes nowhere; pulling it out still gets through
  say(maker, { t: "floor", state: "held" });
  await settle();
  clear();
  say(guest, { t: "rtc", to: M, line: "in", s: { k: "want" } });
  say(guest, { t: "rtc", to: M, line: "out", s: offer });
  say(guest, { t: "live", e: { t: "guitar", track: 0 } });
  say(guest, { t: "live", e: { t: "guitar", track: null } });
  expect(maker.sent).toEqual([{ t: "rtc", from: G, line: "in", s: { k: "want" } }, { t: "live", from: G, e: { t: "guitar", track: null } }]);
});
