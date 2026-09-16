// @rustybuns/ports
// Types only. Zero runtime, zero deps. Every shell (Bun, Cloudflare, Hetzner)
// satisfies these STRUCTURALLY: same method names, no wrapper objects.

/** The four things an app needs. A shell is anything that provides them. */
export interface Ports<Env = Record<string, unknown>> {
  http: HttpPort<Env>;
  comms: CommsPort;
  storage: StoragePort;
  memory: MemoryPort;
  reporter: Reporter;
}

// ---- http -----------------------------------------------------------------

/** Workers-shaped fetch handler. RWSDK, Hono, plain fetch: all fit. */
export interface FetchHandler<Env> {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
}

export interface ExecutionContext {
  waitUntil(p: Promise<unknown>): void;
  passThroughOnException?(): void;
}

export interface HttpPort<Env> {
  /** Mount a Workers-shaped handler. The shell owns the listener. */
  mount(handler: FetchHandler<Env>, env: Env): void;
  /** Where the shell is reachable from the browser this shell opened. */
  readonly url: string;
}

// ---- comms ----------------------------------------------------------------

/** What the engine sees. CF's WebSocket and Bun's ServerWebSocket both fit. */
export interface Socket {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(v: unknown): void;
  deserializeAttachment(): unknown;
}

export interface SocketHandlers {
  open?(ws: Socket): void | Promise<void>;
  message(ws: Socket, data: string | ArrayBuffer): void;
  close(ws: Socket, code: number, reason: string): void;
  error?(ws: Socket, err: unknown): void;
}

export interface CommsPort {
  /** Route WebSocket upgrades on `path` to these handlers. */
  websocket(path: string, handlers: SocketHandlers): void;
  /** Every live socket, accept order preserved (CF getWebSockets contract). */
  sockets(): Socket[];
  /** Broadcast helper. Shells may implement with native pub/sub. */
  broadcast(data: string | ArrayBuffer | Uint8Array): void;
}

// ---- storage --------------------------------------------------------------

/** DO-storage-shaped KV. Same signature on CF, sqlite, and in-memory. */
export interface StoragePort {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(opts?: { prefix?: string; limit?: number }): Promise<Map<string, T>>;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

// ---- memory ---------------------------------------------------------------

export interface MemoryPort {
  /** Capabilities the app must branch on instead of assuming. */
  readonly caps: {
    sab: boolean;       // SharedArrayBuffer across workers
    ffi: boolean;       // bun:ffi available
    fs: boolean;        // real filesystem
    gpu: boolean;       // native GPU access from this process
  };
  /** Spawn a worker thread from a module path. */
  worker(modulePath: string): Worker;
}

// ---- reporter -------------------------------------------------------------

export interface Reporter {
  breadcrumb(name: string, data?: Record<string, unknown>): void;
  report(err: unknown, ctx?: Record<string, unknown>): void;
  escaped(where: string, err: unknown, ctx?: Record<string, unknown>): void;
}

// ---- app ------------------------------------------------------------------

/** What a Rusty Buns app exports. The shell calls these; nothing else. */
export interface App<Env = Record<string, unknown>> {
  fetch?: FetchHandler<Env>["fetch"];
  ws?: SocketHandlers;
  restore?(): Promise<void>;
  alarm?(): void | Promise<void>;
}

export type Caps = MemoryPort["caps"];
