// One Durable Object per room: the riders' sockets and their latest poses. It relays, it does not simulate.
// The Worker (worker.ts) is the only place identity is decided; it vouches X-User-Id and X-User-Name. Seats, the
// other tab taking over and the send loop are @rustybuns/util/seats; the room and its views are this game's.
import { MAX_RIDERS, parsePose, Room, type ServerMsg } from "../net/room.ts";
import { Loop, Seats, vouched } from "@rustybuns/util/seats";
import type { RoomCtx, RoomSocket } from "@rustybuns/util/room";
import { APP } from "../eqosys.ts";

const SEND_MS = 50;
const LIMITS = { maxBytes: 1024, rate: 40, burst: 80 };

/** What a socket carries through hibernation. */
interface Rider { id: string; name: string }

export class World {
  private room = new Room();
  private seats: Seats<Rider, ServerMsg>;
  private loop = new Loop(SEND_MS, () => this.flush());
  private dirty = false;

  constructor(ctx: RoomCtx, _env: unknown) {
    this.seats = new Seats(ctx, LIMITS);
    // After hibernation the room is empty but the sockets live on: rebuild it from their seats.
    for (const a of this.seats.here()) this.room.join(a.id, a.name);
    if (this.seats.open().length) this.loop.start();
  }

  async fetch(request: Request): Promise<Response> {
    const who = await vouched(request, APP, "Skater");
    if (who instanceof Response) return who;
    if (!this.room.join(who.id, who.name)) return Response.json({ error: "full", max: MAX_RIDERS }, { status: 503 });
    const { response } = this.seats.take({ id: who.id, name: who.name });
    this.loop.start();
    return response;
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.seats.frame(ws, raw);
    const who = this.seats.who(ws);
    if (!frame || !who) return;
    const pose = parsePose(frame.value);
    if (!pose) return;
    this.room.pose(who.id, pose);
    this.dirty = true;
  }

  webSocketClose(ws: RoomSocket) { this.gone(ws); }
  webSocketError(ws: RoomSocket) { this.gone(ws); }

  private gone(ws: RoomSocket) {
    const id = this.seats.leave(ws);
    if (id) this.room.leave(id);
    this.dirty = true;
    if (!this.seats.open().length) this.loop.stop();
  }

  /** Each socket gets its own view when anyone moved. */
  private flush() {
    if (!this.dirty) return;
    this.dirty = false;
    for (const ws of this.seats.open()) {
      const who = this.seats.who(ws);
      if (who) this.seats.send(ws, { t: "view", view: this.room.view(who.id) });
    }
  }
}
