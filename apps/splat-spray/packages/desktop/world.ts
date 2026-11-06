// The world: one match. On the desktop it runs in-process for whoever clicked "Host a LAN game",
// and guests reach it over ws:// with the join passphrase; the host vouches X-User-Id and
// X-User-Name for each. Online it is the Durable Object behind each room code (src/edge/worker.ts
// vouches instead). The vouched X-User-Id is the player's login, so it never enters the match:
// each plays under publicId(uid), a hash of it, and that is the id views carry.
// Seats, the other tab taking over and the tick are @rustybuns/util/seats.
import type { RoomCtx, RoomSocket } from "@rustybuns/util/room";
import { Loop, Seats, vouched } from "@rustybuns/util/seats";
import { APP } from "../../src/eqosys.ts";
import { Match, parseMsg, type ServerMsg } from "../../src/match/game.ts";
import { ALL_THINGS } from "../../src/levels/room.ts";
import { QUICK } from "../../src/edge/match.ts";

const TICK_MS = 250;
const LIMITS = { maxBytes: 256, rate: 10, burst: 20 };

interface Ctx extends RoomCtx { storage: { setAlarm(at: number): Promise<void> } }
interface Player { id: string }

export default class World {
  private match = new Match(ALL_THINGS.length);
  private sockets: Seats<Player, ServerMsg>;
  private loop = new Loop(TICK_MS, () => { this.match.tick(Date.now()); this.flush(); });

  constructor(private ctx: Ctx, _env: unknown) { this.sockets = new Seats(ctx, LIMITS); }

  async fetch(request: Request): Promise<Response> {
    // Only the Matchmaker gets here: the Worker sends players' requests on /ws.
    if (new URL(request.url).pathname === "/quick") {
      const at = Number(new URL(request.url).searchParams.get("at"));
      if (!Number.isFinite(at)) return new Response("bad start time", { status: 400 });
      await this.ctx.storage.setAlarm(at);
      return new Response(null, { status: 204 });
    }
    const who = await vouched(request, APP, "Spy");
    if (who instanceof Response) return who;
    if (!this.match.join(who.id, who.name)) return Response.json({ error: "full" }, { status: 503 });
    const { response } = this.sockets.take({ id: who.id });
    this.flush();
    this.loop.start();
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

  /** Quick play's window closed: bots fill the room out and the race starts. */
  alarm() {
    this.match.quickStart(Date.now(), QUICK.size);
    this.flush();
  }

  webSocketClose(ws: RoomSocket) { this.gone(ws); }
  webSocketError(ws: RoomSocket) { this.gone(ws); }

  private gone(ws: RoomSocket) {
    const id = this.sockets.leave(ws);
    if (id) this.match.leave(id, Date.now());
    if (!this.sockets.open().length) this.loop.stop();
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
