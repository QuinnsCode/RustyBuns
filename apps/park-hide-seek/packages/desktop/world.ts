// The world: one hunt. On the desktop it runs in-process for whoever clicked
// "Host a LAN game", and guests reach it over ws:// with the join passphrase;
// the host vouches X-User-Id / X-User-Name for each. Online it is the Durable
// Object behind each room code (src/edge/worker.ts vouches instead), and a
// quick play room starts itself on an alarm the Matchmaker sets.
// The Room here is the same one the page runs for single player.
// The vouched X-User-Id is the player's login: whoever sends it again is them.
// So it never enters the game. Each player plays under publicId(uid), a hash
// of it, and that is the id views carry, so nobody can lift another's login.
import { Room, TICK_MS } from "../../src/room.ts";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { QUICK } from "../../src/edge/match.ts";
import { parseMsg, type ServerMsg } from "../../src/hunt/game.ts";
import { fetchWeather } from "../../src/weather.ts";

// Views go out at most this often per socket.
const SEND_MS = 66;
// Positions come in about 20 a second; anything past this is dropped.
const LIMITS = { maxBytes: 4096, rate: 40, burst: 80 };
// The same player from another tab or a reconnect: the older socket is closed with this.
export const CLOSE_REPLACED = 4001;

interface Ctx extends RoomCtx { storage: { setAlarm(at: number): Promise<void> } }
/** What a socket carries through hibernation. */
interface Player { id: string }

/** The id a player is known by in the game and in every view: a one-way hash of their secret uid. */
export async function publicId(uid: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("park-hide-seek:" + uid)));
  return Array.from(hash.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default class World {
  // The host looks up the park's weather; guests get it in their views.
  private room = new Room(Date.now(), fetchWeather);
  private sockets: Sockets<Player, ServerMsg>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sent = new WeakMap<object, { v: number; at: number }>();

  constructor(private ctx: Ctx, _env: unknown) {
    this.sockets = new Sockets(ctx, LIMITS);
  }

  async fetch(request: Request): Promise<Response> {
    // Only the Matchmaker gets here: the Worker sends players' requests on /ws.
    if (new URL(request.url).pathname === "/quick") {
      const at = Number(new URL(request.url).searchParams.get("at"));
      if (!Number.isFinite(at)) return new Response("bad start time", { status: 400 });
      await this.ctx.storage.setAlarm(at);
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const uid = request.headers.get("X-User-Id");
    if (!uid) return new Response("Unauthenticated", { status: 401 });
    const id = await publicId(uid);
    const name = request.headers.get("X-User-Name") || "Ranger";
    const host = request.headers.get("X-RB-Principal") !== "guest";
    const now = Date.now();
    if (!this.room.game.join(id, name, now, { host })) return Response.json({ error: "full" }, { status: 503 });
    const { server, response } = this.sockets.upgrade({ id });
    // one socket per player: a reconnect or second tab replaces the older one (after
    // the new one is in, so the old one's close does not take the player out)
    this.sockets.replace(server, (a) => a.id === id, CLOSE_REPLACED);
    this.flush(true);
    this.send(server, id, now);
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    return response;
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const now = Date.now();
    const frame = this.sockets.frame(ws, raw, now);
    const who = this.sockets.who(ws);
    if (!frame || !who) return;
    const m = parseMsg(frame.value);
    if (!m) return;
    this.room.handle(who.id, m, now);
    // Positions stream in all the time; the tick sends views out at its own pace.
    if (m.t !== "pos") this.flush(true);
  }

  /** Quick play's window closed: fill the room out with AI and start, on behalf of whoever hosts it. */
  alarm() {
    const g = this.room.game, host = g.hostId, now = Date.now();
    if (!host || g.phase !== "lobby") return;
    for (let n = g.players.filter((p) => p.online).length; n < QUICK.size; n++) this.room.handle(host, { t: "bot", level: "normal" }, now);
    this.room.handle(host, { t: "start" }, now);
    this.flush(true);
  }

  webSocketClose(ws: RoomSocket) { this.gone(ws); }
  webSocketError(ws: RoomSocket) { this.gone(ws); }

  private gone(ws: RoomSocket) {
    const id = this.sockets.who(ws)?.id;
    if (id && !this.sockets.others(ws, (a) => a.id === id).length) this.room.game.leave(id, Date.now());
    if (!this.sockets.open().length && this.timer) { clearInterval(this.timer); this.timer = null; }
    this.flush();
  }

  private tick() {
    this.room.tick(Date.now());
    this.flush();
  }

  /** Send each socket its own view when the game moved, at most every SEND_MS. */
  private flush(force = false) {
    const now = Date.now();
    const v = this.room.game.version;
    for (const ws of this.sockets.open()) {
      const last = this.sent.get(ws);
      if (!force && last && (last.v === v || now - last.at < SEND_MS)) continue;
      const who = this.sockets.who(ws);
      if (who) this.send(ws, who.id, now);
    }
  }

  private send(ws: RoomSocket, id: string, now: number) {
    this.sockets.send(ws, { t: "view", view: this.room.game.view(id, now) });
    this.sent.set(ws, { v: this.room.game.version, at: now });
  }
}
