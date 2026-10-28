// What a game world (a Durable Object, or Rusty Buns' in-process twin of one) needs from its
// sockets, declared once. A world keeps its Durable Object shape and no base class: it holds a
// `Sockets` and hands it the upgrade, the attachment, the per-socket limits and the fan-out.
import { TokenBucket } from "./limits.ts";

/** A hibernating socket as workerd, the Rusty Buns host and the tests' fakes all provide it. */
export interface RoomSocket {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  /** Per-connection state that must outlive the object's memory (hibernation). */
  serializeAttachment(v: unknown): void;
  deserializeAttachment(): unknown;
  /** 1 while open. Absent on a fake, which counts as open. */
  readonly readyState?: number;
}

/** The part of a DurableObjectState the sockets need. */
export interface RoomCtx {
  acceptWebSocket(ws: RoomSocket, tags?: string[]): void;
  getWebSockets(tag?: string): RoomSocket[];
}

// Provided by workerd and by the Rusty Buns host.
declare const WebSocketPair: { new (): Record<0 | 1, RoomSocket> };

interface UpgradeInit extends ResponseInit { webSocket: RoomSocket }

/** Limits on what one socket may send: a frame past `maxBytes` is dropped, and so is one over the rate. */
export interface RoomLimits {
  maxBytes: number;
  /** Messages a second, and the burst a quiet socket may save. */
  rate: number;
  burst: number;
  /** Tokens a frame of this many bytes costs (default 1). */
  cost?: (bytes: number) => number;
  /** A socket over its rate (default: the frame is dropped and the socket stays). */
  onFlood?: (ws: RoomSocket) => void;
}

/** A frame that got through the limits: the parsed JSON (still unchecked) and its size. */
export interface Frame { value: unknown; bytes: number }

/**
 * One world's sockets, each carrying an attachment of type `A` that `upgrade` or `attach` stored
 * and `who` reads back after hibernation. `Out` is what `send` and `broadcast` take.
 */
export class Sockets<A, Out = unknown> {
  /** In memory only: a woken world starts every socket with a full bucket. */
  private buckets = new WeakMap<RoomSocket, TokenBucket>();

  constructor(private ctx: RoomCtx, private limits?: RoomLimits) {}

  /** A pair for an upgrade: the server end accepted with `attach` on it, and the 101 that carries the client end. */
  upgrade(attach: A, tags?: string[]): { server: RoomSocket; response: Response } {
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment(attach);
    const init: UpgradeInit = { status: 101, webSocket: client };
    return { server, response: new Response(null, init) };
  }

  attach(ws: RoomSocket, a: A) { ws.serializeAttachment(a); }

  /** The attachment `upgrade` or `attach` put on `ws`, or null before either. */
  who(ws: RoomSocket): A | null {
    const a = ws.deserializeAttachment();
    return a === undefined || a === null ? null : (a as A);
  }

  /** Accepted sockets still open: getWebSockets can list one that is closing. */
  open(): RoomSocket[] {
    return this.ctx.getWebSockets().filter((w) => w.readyState === undefined || w.readyState === 1);
  }

  /** Every open socket but `ws` whose attachment `same` matches: the player's other tabs. */
  others(ws: RoomSocket, same: (a: A) => boolean): RoomSocket[] {
    return this.open().filter((w) => {
      if (w === ws) return false;
      const a = this.who(w);
      return a !== null && same(a);
    });
  }

  /** Close the player's older sockets once the new one is in, so their close never takes the player out. */
  replace(ws: RoomSocket, same: (a: A) => boolean, code: number, reason = "replaced") {
    for (const old of this.others(ws, same)) try { old.close(code, reason); } catch { /* already closing */ }
  }

  /**
   * A frame in, through the limits: null for a binary frame, one past `maxBytes`, one over the
   * socket's rate (after `onFlood`), or one that isn't JSON. The value is still unchecked.
   */
  frame(ws: RoomSocket, raw: string | ArrayBuffer, now = Date.now()): Frame | null {
    if (typeof raw !== "string") return null;
    const l = this.limits;
    if (l) {
      if (raw.length > l.maxBytes) return null;
      let b = this.buckets.get(ws);
      if (!b) this.buckets.set(ws, (b = new TokenBucket(l.rate, l.burst, now)));
      if (!b.take(now, l.cost?.(raw.length) ?? 1)) { l.onFlood?.(ws); return null; }
    }
    try { return { value: JSON.parse(raw), bytes: raw.length }; } catch { return null; }
  }

  /** One message to one socket; a closing socket's throw is nothing to act on. */
  send(ws: RoomSocket, m: Out) {
    try { ws.send(JSON.stringify(m)); } catch { /* closing; its close event cleans up */ }
  }

  /** One message to every open socket but `except`, or only those whose attachment `to` matches. */
  broadcast(m: Out, except?: RoomSocket, to?: (a: A) => boolean) {
    const s = JSON.stringify(m);
    for (const ws of this.open()) {
      if (ws === except) continue;
      if (to) { const a = this.who(ws); if (a === null || !to(a)) continue; }
      try { ws.send(s); } catch { /* closing */ }
    }
  }
}
