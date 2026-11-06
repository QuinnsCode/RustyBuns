// The world: one battle room, shaped like a Durable Object. On the desktop the Rusty Buns host
// runs it in-process for whoever clicked "Host a battle", and guests on the LAN reach it over
// ws:// with the join passphrase; the host vouches X-User-Id and X-User-Name for each. The host
// player sends the setup (level, mode, repo, and a lat/long level's ground); everyone who joins
// gets it in their welcome and builds the same map. Then the room runs at SNAP_HZ: step the
// battle, send each player their snapshot, a binary delta against the last one their inputs
// acked. The vouched uid only keys the player here; snapshots carry soldier ids and names.
//
// Online (src/edge/worker.ts) the same class is a Durable Object per room code, with env.ONLINE
// set. Everyone there is a guest, so the first to send a setup owns the room and only they can
// pick again; a room nobody has sent input to for IDLE_MS closes, so a forgotten tab doesn't
// keep a 20 Hz room billed; and once everyone has left, the battle ends.

import { cleanSetup, Room } from "./room.ts";
import { decodeToWorld, encodeSnap, SNAP_HZ, type FromWorld, type Look } from "./wire.ts";
import type { RoomCtx, RoomSocket } from "@rustybuns/util/room";
import { Loop, SEAT_CLOSE, Seats, vouched } from "@rustybuns/util/seats";
import { APP } from "../eqosys.ts";

/** Inputs come in at about 30 a second; past this many a second, they're dropped. A setup is big, an input is not. */
const LIMITS = { maxBytes: 1_000_000, rate: 90, burst: 120 };
const MAX_INPUT = 2048;
/** Online, the room closes once no input has come in for this long. */
export const IDLE_MS = 5 * 60_000;

const LOOK = /^[a-z0-9-]{1,24}$/;

/** What a socket carries through hibernation: the seat is held by the vouched uid. */
interface Who { id: string; name: string; look: Look; host: boolean }

export default class World {
  room: Room | null = null;
  private sockets: Seats<Who, FromWorld>;
  private loop = new Loop(1000 / SNAP_HZ, () => this.tick());
  private rounds = new WeakMap<object, number>();
  /** Online: the uid of whoever picked the battle. */
  private owner: string | null = null;
  private lastInput = Date.now();

  constructor(ctx: RoomCtx, private env: { ONLINE?: string }) {
    this.sockets = new Seats(ctx, LIMITS);
  }

  private get online(): boolean { return !!this.env.ONLINE; }

  async fetch(request: Request): Promise<Response> {
    const v = await vouched(request, APP, "soldier");
    if (v instanceof Response) return v;
    const q = new URL(request.url).searchParams;
    const look: Look = { head: LOOK.test(q.get("head") ?? "") ? q.get("head")! : "ball", build: LOOK.test(q.get("build") ?? "") ? q.get("build")! : "average" };
    // A guest's name comes vouched with its uid; the host's own socket names itself.
    const name = (v.host ? q.get("name") : null) || v.name;
    const who: Who = { id: v.uid, name: name.slice(0, 24), look, host: v.host };
    // One socket per player: a reconnect or second tab takes the seat over.
    const { server, response } = this.sockets.take(who);
    this.enter(server, who);
    if (!this.loop.running) this.lastInput = Date.now(), this.loop.start();
    return response;
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const now = Date.now();
    const frame = this.sockets.frame(ws, raw, now), who = this.sockets.who(ws);
    if (!frame || !who) return;
    const m = decodeToWorld(frame.value);
    if (m?.t === "in" && frame.bytes <= MAX_INPUT) this.room?.input(who.id, m.i), this.room?.ack(who.id, m.ack), (this.lastInput = now);
    else if (m?.t === "setup" && this.mayPick(who)) {
      // The host picks the battle; a new pick starts it over, with everyone still here.
      const setup = cleanSetup(m.setup);
      if (!setup) return;
      this.room = new Room(setup, this.room?.seq);
      if (this.online) this.owner = who.id;
      for (const w of this.sockets.open()) { const a = this.sockets.who(w); if (a) this.enter(w, a); }
    }
  }

  /** On the desktop, the host's own socket; online, whoever picks first, then only them. */
  private mayPick(who: Who): boolean {
    return this.online ? this.owner === null || this.owner === who.id : who.host;
  }

  webSocketClose(ws: RoomSocket) { this.gone(ws); }
  webSocketError(ws: RoomSocket) { this.gone(ws); }

  /** A socket into the battle, if there is one yet: a welcome, or wait for the host's setup. */
  private enter(ws: RoomSocket, who: Who) {
    if (!this.room) return this.sockets.send(ws, { t: "wait" });
    if (this.room.join(who.id, who.name, who.look) === null) {
      try { ws.close(SEAT_CLOSE.full, "full"); } catch {}
      return;
    }
    this.welcome(ws, who);
  }

  private welcome(ws: RoomSocket, who: Who) {
    const room = this.room!, me = room.idOf(who.id);
    if (me === undefined) return;
    const snap = room.snap(who.id, { events: [], files: [] }, true);
    if (!snap) return;
    this.rounds.set(ws, room.round);
    this.sockets.send(ws, { t: "welcome", setup: room.setup, me, roster: room.rosterNow(), files: room.filesNow(), snap });
  }

  private gone(ws: RoomSocket) {
    const id = this.sockets.leave(ws);
    if (id) this.room?.leave(id);
    if (this.sockets.open().length) return;
    this.loop.stop();
    if (this.online) this.room = null, (this.owner = null);
  }

  private tick() {
    const now = Date.now();
    if (this.online && now - this.lastInput > IDLE_MS) {
      for (const ws of this.sockets.open()) try { ws.close(SEAT_CLOSE.idle, "idle"); } catch {}
      this.loop.stop();
      this.room = null, this.owner = null;
      return;
    }
    const room = this.room;
    if (!room) return;
    room.tick(now);
    const shared = room.drain();
    for (const ws of this.sockets.open()) {
      const who = this.sockets.who(ws);
      if (!who) continue;
      if (this.rounds.get(ws) !== room.round) {
        if (room.idOf(who.id) !== undefined) this.welcome(ws, who);
        continue;
      }
      const snap = room.snap(who.id, shared);
      if (snap) try { ws.send(encodeSnap(snap)); } catch {}
    }
  }

}
