// Fake platform for engine tests: sockets, storage, and a clock you wind by hand.
import type { Clock, EngineCtx, EngineSocket } from "../src/engine/ports.ts";
import type { ServerMsg } from "../src/engine/wire.ts";

export class FakeSocket implements EngineSocket {
  sent: ServerMsg[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private att: unknown = null;
  send(d: string) { if (this.closed) throw new Error("closed"); this.sent.push(JSON.parse(d)); }
  close(code?: number, reason?: string) { this.closed = { code, reason }; }
  serializeAttachment(v: unknown) { this.att = structuredClone(v); }
  deserializeAttachment() { return this.att; }
  of<T extends ServerMsg["t"]>(t: T) { return this.sent.filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[]; }
  last<T extends ServerMsg["t"]>(t: T) { return this.of(t).at(-1); }
}

export class FakeCtx implements EngineCtx {
  sockets: FakeSocket[] = [];
  store = new Map<string, unknown>();
  storage = {
    get: async <T>(k: string) => structuredClone(this.store.get(k)) as T | undefined,
    put: async (k: string, v: unknown) => { this.store.set(k, structuredClone(v)); },
  };
  getWebSockets() { return this.sockets.filter((s) => !s.closed); }
}

export class ManualClock implements Clock {
  t = 1_000_000;
  private q: { at: number; fn: () => void; id: number }[] = [];
  private n = 0;
  now() { return this.t; }
  schedule(fn: () => void, ms: number) { const id = ++this.n; this.q.push({ at: this.t + ms, fn, id }); return id; }
  clear(h: unknown) { this.q = this.q.filter((x) => x.id !== h); }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at);
      const next = this.q[0];
      if (!next || next.at > end) break;
      this.q.shift(); this.t = Math.max(this.t, next.at); next.fn();
    }
    this.t = end;
  }
  pending() { return this.q.length; }
}
