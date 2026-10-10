// The world's limits on a fake platform: sockets per room, messages per socket,
// and an online room left empty long enough is deleted (the desktop's never is).
import { expect, test, setSystemTime, afterEach } from "bun:test";
import World, { CLOSE_FLOOD, MAX_SOCKETS } from "../packages/desktop/world.ts";
import { TRACKS } from "../src/engine/params.ts";

class Sock {
  readyState = 1; sent: any[] = []; closed: number | null = null; att: unknown;
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close(code: number) { this.closed = code; this.readyState = 3; }
  serializeAttachment(v: unknown) { this.att = v; }
}
(globalThis as any).WebSocketPair = class { 0 = new Sock(); 1 = new Sock(); };
// Bun's Response refuses status 101; the world's reply shape is not what these tests check.
const RealResponse = Response;
(globalThis as any).Response = class extends RealResponse {
  constructor(body: any, init?: any) { super(body, init?.status === 101 ? { status: 200 } : init); }
};

async function setup() {
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
    acceptWebSocket: (s: Sock) => { ctx.sockets.push(s); },
    gate: Promise.resolve() as Promise<unknown>,
    blockConcurrencyWhile: (f: () => Promise<unknown>) => (ctx.gate = f()),
  };
  const world = new World(ctx, {});
  await ctx.gate;                                                  // the platform holds events until the constructor is done
  const join = async (headers: Record<string, string> = {}) => {
    const r = await world.fetch(new Request("http://x/ws", { headers: { Upgrade: "websocket", "X-User-Id": "u", ...headers } }));
    return { status: r.status, ws: ctx.sockets.at(-1)! };
  };
  const leave = (ws: Sock) => { ws.close(1000); world.webSocketClose(ws); };
  return { ctx, store, world, join, leave };
}
const project = { v: 1, bpm: 120, swing: 0, bars: 2, tracks: Array.from({ length: TRACKS }, () => ({ params: [], notes: [] })) };

afterEach(() => setSystemTime());
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test("a room refuses sockets past its limit", async () => {
  const { join } = await setup();
  for (let i = 0; i < MAX_SOCKETS; i++) expect((await join()).status).not.toBe(503);
  expect((await join()).status).toBe(503);
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
