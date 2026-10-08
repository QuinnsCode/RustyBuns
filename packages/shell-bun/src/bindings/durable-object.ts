// In-process Durable Objects. A DO class exported from the worker bundle runs
// here unchanged: same constructor(ctx, env), same fetch(), same hibernation
// handlers (webSocketMessage/Close/Error), same storage + alarm surface.
//
// WebSockets: the DO does `new WebSocketPair()`, `ctx.acceptWebSocket(server)`,
// and returns `new Response(null, { status: 101, webSocket: client })`. The
// shell sees the 101, upgrades the real Bun socket, and bridges it to `client`.
// From then on browser frames reach `webSocketMessage(server, data)` and
// `server.send()` reaches the browser. Zero changes to the DO.
//
// Eviction: `namespace.evict(id)` drops the instance the way CF does after
// hibernation or a restart. Storage, the alarm, accepted sockets (with their
// tags and attachments) survive; the next event (fetch, socket frame, close,
// alarm) constructs a fresh instance from them. Tests use it to exercise the
// restore path, which never runs otherwise because the shell never evicts.

import type { StoragePort } from "@rustybuns/ports";

// ---- local WebSocket ends ----------------------------------------------------

type Data = string | ArrayBuffer | Uint8Array;

export class LocalWebSocket {
  /** Set by the shell on the CLIENT end: pushes frames to the real socket. */
  toBrowser: ((d: Data) => void) | null = null;
  closeBrowser: ((code?: number, reason?: string) => void) | null = null;
  /** Set by the DO state on the SERVER end: hibernation delivery. */
  onMessage: ((d: string | ArrayBuffer) => void) | null = null;
  onClose: ((code: number, reason: string, clean: boolean) => void) | null = null;
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
    // A close the DO starts itself is a close handshake, so always clean.
    this.peer.onClose?.(code, reason, true);
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

/** What outlives an instance: everything CF keeps across eviction. */
interface Slot {
  storage: StoragePort;
  /** Accepted sockets and their tags, in accept order. */
  sockets: Map<LocalWebSocket, string[]>;
  alarmAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const MAX_TAGS = 10, MAX_TAG_LEN = 256;

export class LocalDurableObjectState {
  private gate: Promise<unknown> = Promise.resolve();
  readonly storage: StoragePort & { getAlarm(): Promise<number | null> };
  pending: Promise<unknown>[] = [];
  /** Set by `namespace.evict()`. The instance is gone; see `evicted()`. */
  private dead = false;
  private warned = false;
  private readonly slot: Slot;

  constructor(readonly id: DurableObjectId, storage: StoragePort | Slot, private onAlarm: () => void) {
    this.slot = "sockets" in storage ? storage : { storage, sockets: new Map(), alarmAt: null, timer: null };
    const self = this, slot = this.slot, base = slot.storage;
    // A zombie timer from an evicted instance must not clobber what the fresh
    // instance writes: drop its writes (reads stay harmless).
    const write = <A extends unknown[], R>(fn: (...a: A) => Promise<R>, dead: R) =>
      (...a: A): Promise<R> => self.zombie() ? Promise.resolve(dead) : fn(...a);
    this.storage = {
      ...base,
      put: write(base.put.bind(base), undefined),
      delete: write(base.delete.bind(base), false),
      setAlarm: write(async (at: number) => {
        slot.alarmAt = at;
        if (slot.timer) clearTimeout(slot.timer);
        slot.timer = setTimeout(() => { slot.timer = null; slot.alarmAt = null; self.onAlarm(); }, Math.max(0, at - Date.now()));
      }, undefined),
      deleteAlarm: write(async () => { slot.alarmAt = null; if (slot.timer) clearTimeout(slot.timer); slot.timer = null; }, undefined),
      async getAlarm() { return slot.alarmAt; },
    };
  }

  waitUntil(p: Promise<unknown>) {
    // A rejected waitUntil is otherwise invisible: CF drops it, and a
    // hand-rolled host would console.error. Do the latter.
    this.pending.push(p.catch((err) => console.error("[waitUntil]", err)));
  }
  async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.gate.then(fn);
    this.gate = run.catch(() => {});
    return run;
  }
  /** Await this before delivering any event: mirrors CF's constructor gate. */
  ready() { return this.gate; }

  acceptWebSocket(ws: LocalWebSocket, tags: string[] = []) {
    if (tags.length > MAX_TAGS) throw new Error(`acceptWebSocket: at most ${MAX_TAGS} tags, got ${tags.length}`);
    for (const t of tags) {
      if (typeof t !== "string" || t.length === 0 || t.length > MAX_TAG_LEN) throw new Error(`acceptWebSocket: tags must be 1-${MAX_TAG_LEN} character strings`);
    }
    ws.accept();
    this.slot.sockets.set(ws, [...new Set(tags)]);
    ws.onClose = () => { this.slot.sockets.delete(ws); };
  }
  /** Accepted sockets, optionally only those carrying `tag`. Empty once evicted. */
  getWebSockets(tag?: string): LocalWebSocket[] {
    if (this.zombie()) return [];
    const out: LocalWebSocket[] = [];
    for (const [ws, tags] of this.slot.sockets) if (tag === undefined || tags.includes(tag)) out.push(ws);
    return out;
  }
  getTags(ws: LocalWebSocket): string[] {
    const tags = this.slot.sockets.get(ws);
    if (!tags) throw new Error("getTags: socket was not accepted with acceptWebSocket()");
    return [...tags];
  }
  /** Drop a socket from the live list (bridge close). */
  _detach(ws: LocalWebSocket) { this.slot.sockets.delete(ws); }
  /** Called by the namespace on eviction. */
  _evict() { this.dead = true; }

  /** True once evicted. Timers the old instance started still fire in-process
   * (nothing can kill them); this makes its ctx go quiet instead. */
  private zombie() {
    if (!this.dead) return false;
    if (!this.warned) {
      this.warned = true;
      console.warn(`[durable-object] ${this.id} was evicted but its old instance is still running (a timer?); its socket list is empty and storage writes are dropped`);
    }
    return true;
  }
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
  private slots = new Map<string, Slot>();
  private instances = new Map<string, { obj: DurableObjectLike; state: LocalDurableObjectState }>();
  constructor(private Ctor: DurableObjectCtor<Env>, private env: Env, private opts: NamespaceOptions = {}) {}

  idFromName(name: string) { return new DurableObjectId(name, Bun.hash(name).toString(16).padStart(16, "0")); }
  idFromString(hex: string) { return new DurableObjectId(null, hex); }
  newUniqueId() { return new DurableObjectId(null, crypto.randomUUID().replace(/-/g, "")); }

  /** The live instance for `id`, constructed (or reconstructed after eviction) on demand. */
  private instance(id: DurableObjectId) {
    const key = id.toString();
    let inst = this.instances.get(key);
    if (!inst) {
      let slot = this.slots.get(key);
      if (!slot) {
        slot = { storage: this.opts.storage?.(key) ?? memoryStorage(), sockets: new Map(), alarmAt: null, timer: null };
        this.slots.set(key, slot);
      }
      // The alarm lives in the slot, so it fires into whichever instance is live then.
      const state = new LocalDurableObjectState(id, slot, () => { void this.deliver(id, (obj) => obj.alarm?.()); });
      inst = { obj: new this.Ctor(state, this.env), state };
      this.instances.set(key, inst);
    }
    return inst;
  }

  /** Run one event against the live instance, after its constructor gate. */
  private async deliver<T>(id: DurableObjectId, fn: (obj: DurableObjectLike) => T): Promise<Awaited<T>> {
    const { obj, state } = this.instance(id);
    await state.ready();
    return await fn(obj);
  }

  /**
   * Test hook: evict `id` as CF does after hibernation or a restart. The
   * in-memory instance is dropped; storage, the pending alarm and accepted
   * sockets (tags, attachments) are kept, and the next event builds a new
   * instance from them. Returns false if no instance was live.
   */
  evict(id: DurableObjectId | string): boolean {
    const key = id.toString();
    const inst = this.instances.get(key);
    if (!inst) return false;
    this.instances.delete(key);
    inst.state._evict();
    return true;
  }

  get(id: DurableObjectId) {
    return {
      id,
      fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const req = input instanceof Request ? input : new Request(input, init);
        const res = await this.deliver(id, (obj) => obj.fetch(req));
        const client = (res as any).webSocket as LocalWebSocket | undefined;
        if (res.status === 101 && client) {
          const server = client.peer;
          // Hibernation delivery: browser frames -> whichever instance is live.
          client.onMessage = (d) => { void this.deliver(id, (obj) => obj.webSocketMessage?.(server, d)); };
          const origClose = server.onClose;
          client.onClose = (code, reason, clean) => {
            origClose?.(code, reason, clean);
            void this.deliver(id, (obj) => obj.webSocketClose?.(server, code, reason, clean));
          };
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
