// One Durable Object per room: the riders' sockets and their latest poses. It relays, it does not simulate.
// The Worker (worker.ts) is the only place identity is decided; it vouches X-User-Id and X-User-Name.
import { MAX_RIDERS, parsePose, Room, type ServerMsg } from "../net/room.ts";
import { TokenBucket } from "@rustybuns/util/limits";

declare const WebSocketPair: { new (): Record<0 | 1, unknown> };

const SEND_MS = 50, MAX_MESSAGE = 1024, MSG_RATE = 40, MSG_BURST = 80;
/** The same rider from another tab: the older socket is closed with this. */
export const CLOSE_REPLACED = 4001;

/** The id riders are known by in views: a one-way hash, so nobody can lift another's login. */
export async function publicId(uid: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("skate-tech-park:" + uid)));
  return Array.from(hash.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class World {
  private room = new Room();
  private timer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private buckets = new WeakMap<object, TokenBucket>();

  constructor(private ctx: any, _env: unknown) {
    // After hibernation the room is empty but the sockets live on: rebuild it from their attachments.
    for (const ws of this.open()) {
      const a = ws.deserializeAttachment() as { id: string; name: string } | null;
      if (a) this.room.join(a.id, a.name);
    }
    if (this.open().length) this.timer = setInterval(() => this.flush(), SEND_MS);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const uid = request.headers.get("X-User-Id");
    if (!uid) return new Response("Unauthenticated", { status: 401 });
    const id = await publicId(uid);
    const name = request.headers.get("X-User-Name") || "Skater";
    if (!this.room.join(id, name)) return Response.json({ error: "full", max: MAX_RIDERS }, { status: 503 });
    const [client, server] = Object.values(new WebSocketPair()) as any[];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, name });
    for (const old of this.open()) if (old !== server && (old.deserializeAttachment() as any)?.id === id) try { old.close(CLOSE_REPLACED, "replaced"); } catch {}
    if (!this.timer) this.timer = setInterval(() => this.flush(), SEND_MS);
    return new Response(null, { status: 101, webSocket: client } as any);
  }

  webSocketMessage(ws: any, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
    const now = Date.now();
    let b = this.buckets.get(ws);
    if (!b) { b = new TokenBucket(MSG_RATE, MSG_BURST, now); this.buckets.set(ws, b); }
    if (!b.take(now)) return;
    const { id } = ws.deserializeAttachment() as { id: string };
    let pose;
    try { pose = parsePose(JSON.parse(raw)); } catch { return; }
    if (!pose) return;
    this.room.pose(id, pose);
    this.dirty = true;
  }

  webSocketClose(ws: any) { this.gone(ws); }
  webSocketError(ws: any) { this.gone(ws); }

  private gone(ws: any) {
    const { id } = (ws.deserializeAttachment() ?? {}) as { id?: string };
    const others = this.open().filter((w) => w !== ws && (w.deserializeAttachment() as any)?.id === id);
    if (id && !others.length) this.room.leave(id);
    this.dirty = true;
    if (!this.open().length && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private open(): any[] {
    return this.ctx.getWebSockets().filter((w: any) => w.readyState === undefined || w.readyState === 1);
  }

  /** Each socket gets its own view when anyone moved. */
  private flush() {
    if (!this.dirty) return;
    this.dirty = false;
    for (const ws of this.open()) {
      const { id } = ws.deserializeAttachment() as { id: string };
      try { ws.send(JSON.stringify({ t: "view", view: this.room.view(id) } satisfies ServerMsg)); } catch {}
    }
  }
}
