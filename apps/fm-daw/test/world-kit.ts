// The World (packages/desktop/world.ts) on a fake platform, for the tests that join it: sockets that keep what they
// were sent, a room's storage and alarm, and join / leave. Call useWorld() at the top of a test file.
import { afterAll, beforeAll } from "bun:test";
import World, { type WorldEnv } from "../packages/desktop/world.ts";

export class Sock {
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
/** The platform's WebSocketPair and Response, swapped in for one test file's tests. */
export function useWorld() {
  beforeAll(() => { realPair = (globalThis as any).WebSocketPair; (globalThis as any).WebSocketPair = FakePair; (globalThis as any).Response = FakeResponse; });
  afterAll(() => { (globalThis as any).WebSocketPair = realPair; (globalThis as any).Response = RealResponse; });
}

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
  /** `query`: more of the /ws address, as the page sends it (`invite=...`). */
  const join = async (headers: Record<string, string> = {}, key = "", query = "") => {
    const q = [key && `key=${key}`, query].filter(Boolean).join("&");
    const r = await world.fetch(new Request(`http://x/ws${q ? `?${q}` : ""}`, { headers: { Upgrade: "websocket", "X-User-Id": "u", ...(room ? { "X-Room": room } : {}), ...headers } }));
    return { status: r.status, ws: ctx.sockets.at(-1)! };
  };
  const leave = (ws: Sock) => { ws.close(1000); world.webSocketClose(ws); };
  return { ctx, store, world, join, leave };
}

/** The first message of type `t` the socket was sent, waited for: a hello hashes its key off the event, and one
 *  short timer isn't always long enough on a slow runner (#5490). */
export async function heard(ws: Sock, t: string) {
  for (let i = 0; i < 1000; i++) {
    const m = ws.sent.find((x) => x.t === t);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error(`the socket was never sent a "${t}"`);
}
