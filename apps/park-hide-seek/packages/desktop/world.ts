// The world: one hunt. On the desktop it runs in-process for whoever clicked
// "Host a LAN game", and guests reach it over ws:// with the join passphrase;
// the host vouches X-User-Id / X-User-Name for each. Online it is the Durable
// Object behind each room code (src/edge/worker.ts vouches instead), and a
// quick play room starts itself on an alarm the Matchmaker sets.
// The Room here is the same one the page runs for single player.
// The vouched X-User-Id is the player's login: whoever sends it again is them.
// So it never enters the game. Each player plays under publicId(uid), a hash
// of it, and that is the id views carry, so nobody can lift another's login.
// Seats, the other tab taking over and the tick are @rustybuns/util/seats.
import { Room, TICK_MS } from "../../src/room.ts";
import type { RoomCtx, RoomSocket } from "@rustybuns/util/room";
import { Loop, Seats, vouched } from "@rustybuns/util/seats";
import { APP } from "../../src/api.ts";
import { QUICK } from "../../src/edge/match.ts";
import { parseMsg, type ServerMsg } from "../../src/hunt/game.ts";
import { fetchWeather } from "../../src/weather.ts";

// Views go out at most this often per socket.
const SEND_MS = 66;
// Positions come in about 20 a second; anything past this is dropped.
const LIMITS = { maxBytes: 4096, rate: 40, burst: 80 };

interface Ctx extends RoomCtx { storage: { setAlarm(at: number): Promise<void> } }
/** What a socket carries through hibernation. */
interface Player { id: string }

export default class World {
  // The host looks up the park's weather; guests get it in their views.
  private room = new Room(Date.now(), fetchWeather);
  private sockets: Seats<Player, ServerMsg>;
  private loop = new Loop(TICK_MS, () => this.tick());
  private sent = new WeakMap<object, { v: number; at: number }>();

  constructor(private ctx: Ctx, _env: unknown) {
    this.sockets = new Seats(ctx, LIMITS);
  }

  async fetch(request: Request): Promise<Response> {
    // Only the Matchmaker gets here: the Worker sends players' requests on /ws.
    if (new URL(request.url).pathname === "/quick") {
      const at = Number(new URL(request.url).searchParams.get("at"));
      if (!Number.isFinite(at)) return new Response("bad start time", { status: 400 });
      await this.ctx.storage.setAlarm(at);
      return new Response(null, { status: 204 });
    }
    const who = await vouched(request, APP, "Ranger");
    if (who instanceof Response) return who;
    const { id, name, host } = who, now = Date.now();
    if (!this.room.game.join(id, name, now, { host })) return Response.json({ error: "full" }, { status: 503 });
    // one socket per player: a reconnect or second tab takes the seat over
    const { server, response } = this.sockets.take({ id });
    this.flush(true);
    this.send(server, id, now);
    this.loop.start();
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
    const id = this.sockets.leave(ws);
    if (id) this.room.game.leave(id, Date.now());
    if (!this.sockets.open().length) this.loop.stop();
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
