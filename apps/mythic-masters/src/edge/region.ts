// One Durable Object per party (#3663). A party walks one region at a time, a hunting trip, so that is one per occupied
// region in use; a party that splits up shares its one room instead of waking one per region: the players' sockets and where each one stands. It relays,
// it does not simulate: each page walks its own player, fights its own fights and keeps its own save. What it does
// decide: who may join (six at most), and whether a fight report is believable before the party hears it.
//
// Cheap by design. No timer and no storage: a move is fanned out the moment it arrives, and the latest pose of each
// player rides on their socket's attachment, so the object can hibernate whenever the party stands still and wake with
// everyone where they were. The Worker (worker.ts) is the only place identity is decided; it vouches X-User-Id and X-User-Name.
import { refuseSocket, Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { denNear, MAX_PLAYERS, parseDelta, parseEvent, plausible, WORLD_EPOCH, type Delta, type MetAt, type Player, type ServerMsg } from "../net/party.ts";

/** A pose delta is under 60 bytes; a page sends 5 a second, so 8 a second with a burst of 16 is room to spare. */
export const LIMITS = { maxBytes: 200, rate: 8, burst: 16 };
/** The same player from another tab: the older socket is closed with this. */
export const CLOSE_REPLACED = 4001;
/** A room already holding MAX_PLAYERS: the socket is accepted only to be closed with this, so the page can say so. */
export const CLOSE_FULL = 4003;

/** What a socket carries through hibernation: who, the last pose they sent, and the last den they walked into (creature
 *  and when), which is what a fight report from them is checked against. */
interface Seat { id: string; name: string; p: Delta; met?: MetAt | null }

/** The id players are known by to each other: a one-way hash, so nobody can lift another's login. */
export async function publicId(uid: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mythic-masters:" + uid)));
  return Array.from(hash.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class Region {
  private sockets: Sockets<Seat, ServerMsg>;

  constructor(ctx: RoomCtx, _env: unknown) {
    this.sockets = new Sockets(ctx, LIMITS);
  }

  private seats(): Seat[] {
    const by = new Map<string, Seat>();
    for (const ws of this.sockets.open()) { const s = this.sockets.who(ws); if (s) by.set(s.id, s); }
    return [...by.values()];
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const uid = request.headers.get("X-User-Id");
    if (!uid) return new Response("Unauthenticated", { status: 401 });
    const id = await publicId(uid);
    const name = request.headers.get("X-User-Name") || "Wanderer";
    const here = this.seats(), back = here.find((s) => s.id === id);
    if (!back && here.length >= MAX_PLAYERS) return refuseSocket(JSON.stringify({ error: "full", max: MAX_PLAYERS }), CLOSE_FULL, "full");
    const now = Date.now();
    const { server, response } = this.sockets.upgrade({ id, name, p: back?.p ?? {} });
    this.sockets.replace(server, (a) => a.id === id, CLOSE_REPLACED);
    const players: Player[] = here.filter((s) => s.id !== id).map((s) => ({ id: s.id, name: s.name, p: s.p }));
    this.sockets.send(server, { t: "all", you: id, age: now - WORLD_EPOCH, players });
    if (!back) this.sockets.broadcast({ t: "hi", id, name }, server);
    return response;
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.sockets.frame(ws, raw);
    const seat = this.sockets.who(ws);
    if (!frame || !seat) return;
    const ev = parseEvent(frame.value), others = (a: Seat) => a.id !== seat.id;
    if (ev?.e === "den") {
      if (!denNear(ev.den, seat.p)) return; // not anywhere near where they stand: no den, so no fight to report either
      this.sockets.attach(ws, { ...seat, met: { c: ev.c, lv: ev.lv, at: Date.now(), n: 0 } });
      this.sockets.broadcast({ t: "den", id: seat.id, den: ev.den, c: ev.c }, ws, others);
      return;
    }
    if (ev?.e === "life") { this.sockets.broadcast({ t: "life", id: seat.id, k: ev.k, f: ev.id, h: ev.h }, ws, others); return; }
    if (ev?.e === "hunt") { this.sockets.broadcast({ t: "hunt", id: seat.id, h: ev.h, s: ev.s }, ws, others); return; }
    if (ev?.e === "fought") {
      // Believed only against the den this player walked into, and a doubtful one goes nowhere. The next beast of the
      // line-up's fight there is timed from this report.
      const now = Date.now();
      if (!seat.met || !plausible(seat.met, ev, now)) return;
      this.sockets.attach(ws, { ...seat, met: { ...seat.met, at: now, n: seat.met.n + 1 } });
      this.sockets.broadcast({ t: "fought", id: seat.id, c: ev.c, lv: ev.lv, won: ev.won, bound: ev.bound }, ws, others);
      return;
    }
    const d = parseDelta(frame.value);
    if (!d) return;
    this.sockets.attach(ws, { ...seat, p: { ...seat.p, ...d } });
    this.sockets.broadcast({ t: "p", id: seat.id, d }, ws, (a) => a.id !== seat.id);
  }

  webSocketClose(ws: RoomSocket) { this.gone(ws); }
  webSocketError(ws: RoomSocket) { this.gone(ws); }

  private gone(ws: RoomSocket) {
    const id = this.sockets.who(ws)?.id;
    if (id && !this.sockets.others(ws, (a) => a.id === id).length) this.sockets.broadcast({ t: "bye", id }, ws);
  }
}
