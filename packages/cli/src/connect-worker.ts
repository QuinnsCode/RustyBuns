// The Worker's half of `rustybuns dev`'s inbound TCP (#5506). Alchemy's local workerd opens only HTTP
// sockets for a Worker, so dev can't hand it a raw TCP connection. Instead the dev bridge
// (connect-dev.ts) takes each TCP connection on worker.connect.port and opens a WebSocket to
// CONNECT_PATH, and the dev entry calls the app's own `connect(socket, env, ctx)` with that WebSocket
// dressed as a `cloudflare:sockets` Socket. Binary frames are the bytes; a text "end" frame is a
// half-close (the TCP FIN), which git over ssh needs: it closes its side once it has sent its packs.
//
// connect-dev.ts transpiles this file and writes it beside the dev entry, so it imports nothing.
// Only `rustybuns dev` uses it: a deploy ships the app's own entry, and Spectrum calls connect() itself.

/** Where the dev bridge opens its WebSocket. */
export const CONNECT_PATH = "/__rb/connect";
/** The text frame that says this side has sent everything (a TCP half-close). */
export const END = "end";

/** The bits of a WebSocket both ends use: workerd's accepted server socket and the WHATWG client. */
export interface FrameSocket {
  send(data: ArrayBuffer | Uint8Array | string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", f: (e: { data: unknown }) => void): void;
  addEventListener(type: "close" | "error", f: () => void): void;
}

/** What `connect()` gets: the parts of a `cloudflare:sockets` Socket a handler reaches for. */
export interface InboundSocket {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly opened: Promise<{ remoteAddress?: string; localAddress?: string }>;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

const bytes = (d: unknown): Uint8Array | undefined =>
  d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : undefined;

/** A WebSocket from the dev bridge as the Socket a `connect()` handler reads and writes. */
export function socketOf(ws: FrameSocket): InboundSocket {
  let readDone = false, writeDone = false, finished = false;
  let done!: () => void;
  const closed = new Promise<void>((r) => { done = r; });
  const finish = () => {
    if (finished) return;
    finished = true;
    try { ws.close(1000); } catch { /* already closing */ }
    done();
  };
  let reader!: ReadableStreamDefaultController<Uint8Array>;
  const endRead = () => {
    if (readDone) return;
    readDone = true;
    try { reader.close(); } catch { /* cancelled by the handler */ }
  };
  const readable = new ReadableStream<Uint8Array>({ start(c) { reader = c; } });
  ws.addEventListener("message", (e) => {
    if (typeof e.data === "string") { if (e.data === END) { endRead(); if (writeDone) finish(); } return; }
    const b = bytes(e.data);
    if (b && !readDone) reader.enqueue(b);
  });
  // The bridge went away (the client dropped the connection): nothing more comes, and nothing can go.
  const gone = () => { endRead(); writeDone = true; finished = true; done(); };
  ws.addEventListener("close", gone);
  ws.addEventListener("error", gone);
  const writable = new WritableStream<Uint8Array>({
    write(chunk) { if (!finished) ws.send(chunk); },
    close() { if (writeDone) return; writeDone = true; if (!finished) ws.send(END); if (readDone) finish(); },
    abort() { finish(); },
  });
  return { readable, writable, opened: Promise.resolve({ remoteAddress: "127.0.0.1", localAddress: "127.0.0.1" }), closed, close: async () => finish() };
}

type Ctx = { waitUntil(p: Promise<unknown>): void };
type Handler = (req: Request, env: unknown, ctx: Ctx) => Response | Promise<Response>;
type Connect = (socket: InboundSocket, env: unknown, ctx: Ctx) => unknown;
type WorkerModule = { fetch?: Handler; connect?: Connect };

// workerd's global. This file is copied into the Worker on its own, so it can't import @rustybuns/util/room.
declare const WebSocketPair: new () => { 0: FrameSocket; 1: FrameSocket & { accept(): void } };

/**
 * The app's default export with CONNECT_PATH in front of its fetch: a WebSocket there becomes one
 * `connect()` call, and the connection ends when that call settles, as on the edge.
 */
export function withConnect<W extends WorkerModule>(worker: W): W {
  const connect = worker.connect;
  if (typeof connect !== "function") return worker;
  const fetch: Handler = (req, env, ctx) => {
    if (new URL(req.url).pathname !== CONNECT_PATH || req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return worker.fetch ? worker.fetch(req, env, ctx) : new Response("not found", { status: 404 });
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    server.accept();
    const socket = socketOf(server);
    ctx.waitUntil(Promise.resolve()
      .then(() => connect.call(worker, socket, env, ctx))
      .catch((e: unknown) => console.error("[connect]", e))
      .finally(() => socket.close()));
    const init = { status: 101, webSocket: pair[0] };
    return new Response(null, init);
  };
  return { ...worker, fetch };
}
