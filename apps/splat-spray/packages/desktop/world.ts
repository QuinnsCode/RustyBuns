// The world: one match. On the desktop it runs in-process for whoever clicked "Host a LAN game",
// and guests reach it over ws:// with the join passphrase; the host vouches X-User-Id and
// X-User-Name for each. Online it is the Durable Object behind each room code (src/edge/worker.ts
// vouches instead). The vouched X-User-Id is the player's login, so it never enters the match:
// each plays under publicId(uid), a hash of it, and that is the id views carry.
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { Match, parseMsg, type ServerMsg } from "../../src/match/game.ts";
import { ALL_THINGS } from "../../src/levels/room.ts";

const TICK_MS = 250;
const LIMITS = { maxBytes: 256, rate: 10, burst: 20 };
/** The same player from another tab or a reconnect: the older socket is closed with this. */
export const CLOSE_REPLACED = 4001;

interface Player { id: string }

export async function publicId(uid: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("splat-spray:" + uid)));
  return Array.from(hash.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default class World {
  private match = new Match(ALL_THINGS.length);
  private sockets: Sockets<Player, ServerMsg>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: RoomCtx, _env: unknown) { this.sockets = new Sockets(ctx, LIMITS); }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const uid = request.headers.get("X-User-Id");
    if (!uid) return new Response("Unauthenticated", { status: 401 });
    const id = await publicId(uid);
    const name = (request.headers.get("X-User-Name") || "Spy").slice(0, 24);
    if (!this.match.join(id, name)) return Response.json({ error: "full" }, { status: 503 });
    const { server, response } = this.sockets.upgrade({ id });
    this.sockets.replace(server, (a) => a.id === id, CLOSE_REPLACED);
    this.flush();
    if (!this.timer) this.timer = setInterval(() => { this.match.tick(Date.now()); this.flush(); }, TICK_MS);
    return response;
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const now = Date.now();
    const frame = this.sockets.frame(ws, raw, now);
    const who = this.sockets.who(ws);
    const m = frame && parseMsg(frame.value);
    if (!who || !m) return;
    this.match.handle(who.id, m, now);
    this.flush();
  }

  webSocketClose(ws: RoomSocket) { this.gone(ws); }
  webSocketError(ws: RoomSocket) { this.gone(ws); }

  private gone(ws: RoomSocket) {
    const id = this.sockets.who(ws)?.id;
    if (id && !this.sockets.others(ws, (a) => a.id === id).length) this.match.leave(id, Date.now());
    if (!this.sockets.open().length && this.timer) { clearInterval(this.timer); this.timer = null; }
    this.flush();
  }

  /** Each socket gets its own view, only when the match moved since it last had one. */
  private sent = new WeakMap<object, number>();
  private flush() {
    const now = Date.now();
    for (const ws of this.sockets.open()) {
      if (this.sent.get(ws) === this.match.version) continue;
      const who = this.sockets.who(ws);
      if (!who) continue;
      this.sockets.send(ws, { t: "view", view: this.match.view(who.id, now) });
      this.sent.set(ws, this.match.version);
    }
  }
}
