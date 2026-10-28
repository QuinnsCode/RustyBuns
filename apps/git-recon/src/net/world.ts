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
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";

/** Inputs come in at about 30 a second; past this many a second, they're dropped. A setup is big, an input is not. */
const LIMITS = { maxBytes: 1_000_000, rate: 90, burst: 120 };
const MAX_INPUT = 2048;
/** The same player from another tab or a reconnect: the older socket is closed with this. */
export const CLOSE_REPLACED = 4001;
/** The room is full. */
export const CLOSE_FULL = 4002;
/** Online: nobody has played for IDLE_MS. */
export const CLOSE_IDLE = 4003;
/** Online, the room closes once no input has come in for this long. */
export const IDLE_MS = 5 * 60_000;

const LOOK = /^[a-z0-9-]{1,24}$/;

/** What a socket carries through hibernation. */
interface Who { key: string; name: string; look: Look; host: boolean }

export default class World {
  room: Room | null = null;
  private sockets: Sockets<Who, FromWorld>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rounds = new WeakMap<object, number>();
  /** Online: the key of whoever picked the battle. */
  private owner: string | null = null;
  private lastInput = Date.now();

  constructor(ctx: RoomCtx, private env: { ONLINE?: string }) {
    this.sockets = new Sockets(ctx, LIMITS);
  }

  private get online(): boolean { return !!this.env.ONLINE; }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const key = request.headers.get("X-User-Id");
    if (!key) return new Response("Unauthenticated", { status: 401 });
    const q = new URL(request.url).searchParams;
    const look: Look = { head: LOOK.test(q.get("head") ?? "") ? q.get("head")! : "ball", build: LOOK.test(q.get("build") ?? "") ? q.get("build")! : "average" };
    const host = request.headers.get("X-RB-Principal") !== "guest";
    // A guest's name comes vouched with its uid; the host's own socket names itself.
    const name = (host ? q.get("name") : null) || request.headers.get("X-User-Name") || "soldier";
    const who: Who = { key, name: name.slice(0, 24), look, host };
    const { server, response } = this.sockets.upgrade(who);
    // One socket per player: a reconnect or second tab replaces the older one (after the new one is in, so its close doesn't take the player out).
    this.sockets.replace(server, (a) => a.key === key, CLOSE_REPLACED);
    this.enter(server, who);
    if (!this.timer) this.lastInput = Date.now(), (this.timer = setInterval(() => this.tick(), 1000 / SNAP_HZ));
    return response;
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const now = Date.now();
    const frame = this.sockets.frame(ws, raw, now), who = this.sockets.who(ws);
    if (!frame || !who) return;
    const m = decodeToWorld(frame.value);
    if (m?.t === "in" && frame.bytes <= MAX_INPUT) this.room?.input(who.key, m.i), this.room?.ack(who.key, m.ack), (this.lastInput = now);
    else if (m?.t === "setup" && this.mayPick(who)) {
      // The host picks the battle; a new pick starts it over, with everyone still here.
      const setup = cleanSetup(m.setup);
      if (!setup) return;
      this.room = new Room(setup, this.room?.seq);
      if (this.online) this.owner = who.key;
      for (const w of this.sockets.open()) { const a = this.sockets.who(w); if (a) this.enter(w, a); }
    }
  }

  /** On the desktop, the host's own socket; online, whoever picks first, then only them. */
  private mayPick(who: Who): boolean {
    return this.online ? this.owner === null || this.owner === who.key : who.host;
  }

  webSocketClose(ws: RoomSocket) { this.gone(ws); }
  webSocketError(ws: RoomSocket) { this.gone(ws); }

  /** A socket into the battle, if there is one yet: a welcome, or wait for the host's setup. */
  private enter(ws: RoomSocket, who: Who) {
    if (!this.room) return this.sockets.send(ws, { t: "wait" });
    if (this.room.join(who.key, who.name, who.look) === null) {
      try { ws.close(CLOSE_FULL, "full"); } catch {}
      return;
    }
    this.welcome(ws, who);
  }

  private welcome(ws: RoomSocket, who: Who) {
    const room = this.room!, me = room.idOf(who.key);
    if (me === undefined) return;
    const snap = room.snap(who.key, { events: [], files: [] }, true);
    if (!snap) return;
    this.rounds.set(ws, room.round);
    this.sockets.send(ws, { t: "welcome", setup: room.setup, me, roster: room.rosterNow(), files: room.filesNow(), snap });
  }

  private gone(ws: RoomSocket) {
    const who = this.sockets.who(ws);
    if (who && !this.sockets.others(ws, (a) => a.key === who.key).length) this.room?.leave(who.key);
    if (this.sockets.open().length) return;
    if (this.timer) clearInterval(this.timer), (this.timer = null);
    if (this.online) this.room = null, (this.owner = null);
  }

  private tick() {
    const now = Date.now();
    if (this.online && now - this.lastInput > IDLE_MS) {
      for (const ws of this.sockets.open()) try { ws.close(CLOSE_IDLE, "idle"); } catch {}
      if (this.timer) clearInterval(this.timer), (this.timer = null);
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
        if (room.idOf(who.key) !== undefined) this.welcome(ws, who);
        continue;
      }
      const snap = room.snap(who.key, shared);
      if (snap) try { ws.send(encodeSnap(snap)); } catch {}
    }
  }

}
