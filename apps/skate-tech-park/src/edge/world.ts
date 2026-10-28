// One Durable Object per room: the riders' sockets and their latest poses. It relays, it does not simulate.
// The Worker (worker.ts) is the only place identity is decided; it vouches X-User-Id and X-User-Name.
import { MAX_RIDERS, parsePose, Room, type ServerMsg } from "../net/room.ts";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";

const SEND_MS = 50;
const LIMITS = { maxBytes: 1024, rate: 40, burst: 80 };
/** The same rider from another tab: the older socket is closed with this. */
export const CLOSE_REPLACED = 4001;

/** What a socket carries through hibernation. */
interface Rider { id: string; name: string }

/** The id riders are known by in views: a one-way hash, so nobody can lift another's login. */
export async function publicId(uid: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("skate-tech-park:" + uid)));
  return Array.from(hash.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class World {
  private room = new Room();
  private sockets: Sockets<Rider, ServerMsg>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor(ctx: RoomCtx, _env: unknown) {
    this.sockets = new Sockets(ctx, LIMITS);
    // After hibernation the room is empty but the sockets live on: rebuild it from their attachments.
    for (const ws of this.sockets.open()) {
      const a = this.sockets.who(ws);
      if (a) this.room.join(a.id, a.name);
    }
    if (this.sockets.open().length) this.timer = setInterval(() => this.flush(), SEND_MS);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const uid = request.headers.get("X-User-Id");
    if (!uid) return new Response("Unauthenticated", { status: 401 });
    const id = await publicId(uid);
    const name = request.headers.get("X-User-Name") || "Skater";
    if (!this.room.join(id, name)) return Response.json({ error: "full", max: MAX_RIDERS }, { status: 503 });
    const { server, response } = this.sockets.upgrade({ id, name });
    this.sockets.replace(server, (a) => a.id === id, CLOSE_REPLACED);
    if (!this.timer) this.timer = setInterval(() => this.flush(), SEND_MS);
    return response;
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.sockets.frame(ws, raw);
    const who = this.sockets.who(ws);
    if (!frame || !who) return;
    const pose = parsePose(frame.value);
    if (!pose) return;
    this.room.pose(who.id, pose);
    this.dirty = true;
  }

  webSocketClose(ws: RoomSocket) { this.gone(ws); }
  webSocketError(ws: RoomSocket) { this.gone(ws); }

  private gone(ws: RoomSocket) {
    const id = this.sockets.who(ws)?.id;
    if (id && !this.sockets.others(ws, (a) => a.id === id).length) this.room.leave(id);
    this.dirty = true;
    if (!this.sockets.open().length && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Each socket gets its own view when anyone moved. */
  private flush() {
    if (!this.dirty) return;
    this.dirty = false;
    for (const ws of this.sockets.open()) {
      const who = this.sockets.who(ws);
      if (who) this.sockets.send(ws, { t: "view", view: this.room.view(who.id) });
    }
  }
}
