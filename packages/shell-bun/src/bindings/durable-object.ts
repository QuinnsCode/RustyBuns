// In-process Durable Objects. A DO class exported from the worker bundle runs
// here unchanged: same constructor(ctx, env), same fetch(), same hibernation
// handlers (webSocketMessage/Close/Error), same storage + alarm surface.
//
// WebSockets: the DO does `new WebSocketPair()`, `ctx.acceptWebSocket(server)`,
// and returns `new Response(null, { status: 101, webSocket: client })`. The
// shell sees the 101, upgrades the real Bun socket, and bridges it to `client`.
// From then on browser frames reach `webSocketMessage(server, data)` and
// `server.send()` reaches the browser. Zero changes to the DO.

import type { StoragePort } from "@rustybuns/ports";

// ---- local WebSocket ends ----------------------------------------------------

type Data = string | ArrayBuffer | Uint8Array;

export class LocalWebSocket {
  /** Set by the shell on the CLIENT end: pushes frames to the real socket. */
  toBrowser: ((d: Data) => void) | null = null;
  closeBrowser: ((code?: number, reason?: string) => void) | null = null;
  /** Set by the DO state on the SERVER end: hibernation delivery. */
  onMessage: ((d: string | ArrayBuffer) => void) | null = null;
  onClose: ((code: number, reason: string) => void) | null = null;
  peer!: LocalWebSocket;
  /** Frames sent before the shell attached the real socket (CF buffers these too). */
  queue: Data[] = [];
  private attachment: unknown = null;
  readyState = 1;
  accepted = false;

  accept() { this.accepted = true; }
  send(d: Data) {
    if (this.readyState !== 1) throw new Error("WebSocket is not open");
    // server.send -> client end -> browser (or queue until the bridge attaches)
    if (this.peer.toBrowser) this.peer.toBrowser(d);
    else this.peer.queue.push(d);
  }
  close(code = 1000, reason = "") {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.peer.readyState = 3;
    this.peer.closeBrowser?.(code, reason);
    this.peer.onClose?.(code, reason);
  }
  serializeAttachment(v: unknown) { this.attachment = v; }
  deserializeAttachment(): unknown { return this.attachment; }
}

export class WebSocketPair {
  0: LocalWebSocket; 1: LocalWebSocket;
  constructor() {
    const a = new LocalWebSocket(), b = new LocalWebSocket();
    a.peer = b; b.peer = a;
    this[0] = a; this[1] = b;
  }
}

// ---- DurableObjectState -------------------------------------------------------

export class DurableObjectId {
  constructor(readonly name: string | null, private readonly hex: string) {}
  toString() { return this.hex; }
  equals(o: DurableObjectId) { return this.hex === o.hex; }
}

export class LocalDurableObjectState {
  private sockets: LocalWebSocket[] = [];
  private gate: Promise<unknown> = Promise.resolve();
  readonly storage: StoragePort & { getAlarm(): Promise<number | null> };
  private alarmAt: number | null = null;
  pending: Promise<unknown>[] = [];

  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(readonly id: DurableObjectId, storage: StoragePort, private onAlarm: () => void) {
    const self = this;
    this.storage = {
      ...storage,
      async setAlarm(at) {
        self.alarmAt = at;
        if (self.timer) clearTimeout(self.timer);
        self.timer = setTimeout(() => { self.timer = null; self.alarmAt = null; self.onAlarm(); }, Math.max(0, at - Date.now()));
      },
      async deleteAlarm() { self.alarmAt = null; if (self.timer) clearTimeout(self.timer); self.timer = null; },
      async getAlarm() { return self.alarmAt; },
    };
  }

  waitUntil(p: Promise<unknown>) { this.pending.push(p); }
  async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.gate.then(fn);
    this.gate = run.catch(() => {});
    return run;
  }
  /** Await this before delivering any event: mirrors CF's constructor gate. */
  ready() { return this.gate; }

  acceptWebSocket(ws: LocalWebSocket, _tags?: string[]) {
    ws.accept();
    this.sockets.push(ws);
    ws.onClose = () => { const i = this.sockets.indexOf(ws); if (i >= 0) this.sockets.splice(i, 1); };
  }
  getWebSockets(_tag?: string): LocalWebSocket[] { return [...this.sockets]; }
  /** Drop a socket from the live list (bridge close). */
  _detach(ws: LocalWebSocket) { const i = this.sockets.indexOf(ws); if (i >= 0) this.sockets.splice(i, 1); }
}

// ---- Namespace ----------------------------------------------------------------

export interface DurableObjectLike {
  fetch(request: Request): Response | Promise<Response>;
  webSocketMessage?(ws: LocalWebSocket, m: string | ArrayBuffer): void | Promise<void>;
  webSocketClose?(ws: LocalWebSocket, code: number, reason: string, clean: boolean): void | Promise<void>;
  webSocketError?(ws: LocalWebSocket, err: unknown): void | Promise<void>;
  alarm?(): void | Promise<void>;
}

export type DurableObjectCtor<Env> = new (ctx: LocalDurableObjectState, env: Env) => DurableObjectLike;

export interface NamespaceOptions {
  /** One StoragePort per DO id. Default: in-memory. Desktop passes sqlite. */
  storage?: (id: string) => StoragePort;
}

export class LocalDurableObjectNamespace<Env> {
  private instances = new Map<string, { obj: DurableObjectLike; state: LocalDurableObjectState }>();
  constructor(private Ctor: DurableObjectCtor<Env>, private env: Env, private opts: NamespaceOptions = {}) {}

  idFromName(name: string) { return new DurableObjectId(name, Bun.hash(name).toString(16).padStart(16, "0")); }
  idFromString(hex: string) { return new DurableObjectId(null, hex); }
  newUniqueId() { return new DurableObjectId(null, crypto.randomUUID().replace(/-/g, "")); }

  private instance(id: DurableObjectId) {
    const key = id.toString();
    let inst = this.instances.get(key);
    if (!inst) {
      const storage = this.opts.storage?.(key) ?? memoryStorage();
      const state = new LocalDurableObjectState(id, storage, () => { void inst?.obj.alarm?.(); });
      const obj = new this.Ctor(state, this.env);
      inst = { obj, state };
      this.instances.set(key, inst);
    }
    return inst;
  }

  get(id: DurableObjectId) {
    const { obj, state } = this.instance(id);
    return {
      id,
      fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        await state.ready();
        const req = input instanceof Request ? input : new Request(input, init);
        const res = await obj.fetch(req);
        const client = (res as any).webSocket as LocalWebSocket | undefined;
        if (res.status === 101 && client) {
          const server = client.peer;
          // hibernation delivery: browser frames -> DO handlers
          client.onMessage = (d) => { void obj.webSocketMessage?.(server, d); };
          const origClose = server.onClose;
          client.onClose = (code, reason) => { state._detach(server); origClose?.(code, reason); void obj.webSocketClose?.(server, code, reason, true); };
        }
        return res;
      },
    };
  }
  getByName(name: string) { return this.get(this.idFromName(name)); }
}

export function memoryStorage(): StoragePort {
  const m = new Map<string, unknown>();
  let alarm: ReturnType<typeof setTimeout> | null = null;
  return {
    async get<T>(k: string) { return m.get(k) as T | undefined; },
    async put(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { return m.delete(k); },
    async list<T>(o?: { prefix?: string; limit?: number }) {
      const out = new Map<string, T>();
      for (const [k, v] of [...m.entries()].sort()) if (k.startsWith(o?.prefix ?? "")) { out.set(k, v as T); if (o?.limit && out.size >= o.limit) break; }
      return out;
    },
    async setAlarm() {}, async deleteAlarm() { if (alarm) clearTimeout(alarm); },
  };
}

/** Bind a DO class the way wrangler would: env.NAME = namespace. */
export function durableObject<Env>(Ctor: DurableObjectCtor<Env>, env: Env, opts?: NamespaceOptions) {
  return new LocalDurableObjectNamespace(Ctor, env, opts);
}

// ---- Cloudflare globals the DO bundle expects ---------------------------------
// Bun's Response drops unknown init props, and WebSocketPair is a CF global.
let installed = false;
export function installCloudflareGlobals() {
  if (installed) return;
  installed = true;
  const Native = globalThis.Response;
  class RBResponse extends Native {
    webSocket?: LocalWebSocket;
    constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: LocalWebSocket }) {
      super(body, init);
      if (init?.webSocket) this.webSocket = init.webSocket;
    }
  }
  (globalThis as any).Response = RBResponse;
  (globalThis as any).WebSocketPair = WebSocketPair;
}
