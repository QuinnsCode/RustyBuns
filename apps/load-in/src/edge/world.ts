// One Durable Object per crew room: the friends' sockets, their poses, and who holds what (crew/room.ts). It relays
// bodies and referees hands; it doesn't simulate. The Worker (worker.ts) decides who each socket is.
import { Crew, MAX_CREW, readSent, type ServerMsg } from "../crew/room.ts";
import { Loop, Seats, vouched } from "@rustybuns/util/seats";
import type { RoomCtx, RoomSocket } from "@rustybuns/util/room";
import { APP } from "../eqosys.ts";

const SEND_MS = 50;
const LIMITS = { maxBytes: 1024, rate: 40, burst: 80 };

/** What a socket carries through hibernation. */
interface Hand { id: string; name: string }

export class World {
  private crew = new Crew();
  private seats: Seats<Hand, ServerMsg>;
  private loop = new Loop(SEND_MS, () => this.flush());
  private dirty = false;

  constructor(ctx: RoomCtx, _env: unknown) {
    this.seats = new Seats(ctx, LIMITS);
    for (const a of this.seats.here()) this.crew.join(a.id, a.name);
    if (this.seats.open().length) this.loop.start();
  }

  async fetch(request: Request): Promise<Response> {
    const who = await vouched(request, APP, "Roadie");
    if (who instanceof Response) return who;
    if (!this.crew.join(who.id, who.name)) return Response.json({ error: "full", max: MAX_CREW }, { status: 503 });
    const { response } = this.seats.take({ id: who.id, name: who.name });
    this.dirty = true;
    this.loop.start();
    return response;
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.seats.frame(ws, raw);
    const who = this.seats.who(ws);
    const m = frame && who ? readSent(frame.value) : null;
    if (!m || !who) return;
    if (m.t === "pose") this.crew.pose(who.id, m);
    else if (m.t === "drop") this.crew.drop(who.id, m);
    else if (m.t === "switch") this.crew.throw(who.id, m);
    else {
      const got = m.t === "end" ? this.crew.end(who.id, m) : this.crew.grab(who.id, m);
      if (!got.ok) this.seats.send(ws, { t: "refused", key: m.key, why: got.why });
    }
    this.dirty = true;
  }

  webSocketClose(ws: RoomSocket) { this.gone(ws); }
  webSocketError(ws: RoomSocket) { this.gone(ws); }

  private gone(ws: RoomSocket) {
    const id = this.seats.leave(ws);
    if (id) this.crew.leave(id);
    this.dirty = true;
    if (!this.seats.open().length) this.loop.stop();
  }

  /** Each socket gets the room as it sees it, when anything changed. */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    for (const ws of this.seats.open()) {
      const who = this.seats.who(ws);
      if (who) this.seats.send(ws, this.crew.view(who.id));
    }
  }
}
