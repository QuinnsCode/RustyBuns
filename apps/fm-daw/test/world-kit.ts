// A World (packages/desktop/world.ts) on a fake platform: sockets that keep what they were sent, storage in a Map,
// and the platform's WebSocketPair and a Response that takes status 101 swapped in for the calling file's tests.
import { afterAll, beforeAll } from "bun:test";
import World, { type WorldEnv } from "../packages/desktop/world.ts";

export class Sock {
  readyState = 1; sent: any[] = []; closed: number | null = null; att: unknown;
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close(code: number) { this.closed = code; this.readyState = 3; }
  serializeAttachment(v: unknown) { this.att = v; }
  deserializeAttachment() { return this.att; }
}

/** Swap the fakes in for this file's tests only: bun test runs every file in one process, so a fake left
 * behind breaks later files that use the real ones (shell-bun's DO tests). */
export function fakePlatform() {
  const FakePair = class { 0 = new Sock(); 1 = new Sock(); };
  // Bun's Response refuses status 101; the world's reply shape is not what these tests check.
  const RealResponse = Response;
  const FakeResponse = class extends RealResponse {
    constructor(body: any, init?: any) { super(body, init?.status === 101 ? { status: 200 } : init); }
  };
  let realPair: unknown;
  beforeAll(() => { realPair = (globalThis as any).WebSocketPair; (globalThis as any).WebSocketPair = FakePair; (globalThis as any).Response = FakeResponse; });
  afterAll(() => { (globalThis as any).WebSocketPair = realPair; (globalThis as any).Response = RealResponse; });
}

/** One room's World; `join` opens a socket into it, `leave` closes one. */
export async function setup(env: WorldEnv = {}, room = "") {
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
