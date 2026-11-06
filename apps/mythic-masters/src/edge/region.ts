// One Durable Object per party (#3663). A party walks one region at a time, a hunting trip, so that is one per occupied
// region in use; a party that splits up shares its one room instead of waking one per region: the players' sockets and where each one stands. It relays,
// it does not simulate: each page walks its own player, fights its own fights and keeps its own save. What it does
// decide: who may join (six at most), and whether a fight report is believable before the party hears it.
//
// Cheap by design. No timer and no storage: a move is fanned out the moment it arrives, and the latest pose of each
// player rides on their socket's attachment, so the object can hibernate whenever the party stands still and wake with
// everyone where they were. The Worker (worker.ts) is the only place identity is decided; it vouches X-User-Id and X-User-Name.
import { refuseSocket, Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { denNear, holds, landing } from "../net/dens.ts";
import { huntNear, step, FIGHT, MAX_PLAYERS, parseDelta, parseEvent, plausible, WORLD_EPOCH, type Anchor, type Delta, type MetAt, type Player, type ServerMsg } from "../net/party.ts";

/** A pose delta is under 60 bytes and a page sends 5 a second, so 8 a second with a burst of 16 is room to spare. A
 *  newcomer's catch-up (`seen`, up to 30 of each kind) runs to about 4 KB: it fits, and costs a token per 512 bytes. */
export const LIMITS = { maxBytes: 4096, rate: 8, burst: 16, cost: (bytes: number) => 1 + Math.floor(bytes / 512) };
/** A page says "ping" every PING_MS and the runtime answers "pong" itself (setWebSocketAutoResponse: no wake, no
 *  duration). A seat with no ping for this long is a page that vanished without closing: it is closed and the party told. */
export const DEAD_MS = 90_000;
/** The Region's vars. Both are for a local run under workerd (scripts/edge.ts), never set live: a test can't wait
 *  DEAD_MS out, and only a log line shows the object was rebuilt from its sockets after hibernating. */
export interface RegionEnv { DEAD_MS?: string; LOG_WAKES?: string }
/** What this object needs of workerd's hibernation API beyond the sockets (absent on a test's fake: no sweep there). */
interface Alive { setWebSocketAutoResponse?(pair: unknown): void; getWebSocketAutoResponseTimestamp?(ws: RoomSocket): Date | null }
declare const WebSocketRequestResponsePair: (new (req: string, res: string) => unknown) | undefined;
/** The same player from another tab: the older socket is closed with this. */
export const CLOSE_REPLACED = 4001;
/** A room already holding MAX_PLAYERS: the socket is accepted only to be closed with this, so the page can say so. */
export const CLOSE_FULL = 4003;

/** What a socket carries through hibernation: who, the last pose they sent, the last pose the speed check trusts and
 *  when (`a`, see `step`), whether that pose is one the room can't vouch for (`loose`: they jumped somewhere travel doesn't take you, and haven't been anywhere it does since),
 *  the last den they walked into (creature and when), which is what a fight report from them is checked against, and the
 *  regions their page says it has opened (`open`, none said yet: only the first), the only ones a jump may land in. */
interface Seat { id: string; name: string; p: Delta; a?: Anchor; loose?: boolean; met?: MetAt | null; since?: number; open?: number[] }
/** Before a page says what it has opened, a jump lands only in the region every save starts with. */
const FIRST_OPEN = [1];
/** Landing beside a friend (Start, or an agent's join) puts you within this many metres of their last pose. */
const BESIDE_M = 40;

/** The id players are known by to each other: a one-way hash, so nobody can lift another's login. */
export async function publicId(uid: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mythic-masters:" + uid)));
  return Array.from(hash.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class Region {
  private sockets: Sockets<Seat, ServerMsg>;
  private deadMs: number;

  constructor(private ctx: RoomCtx & Alive, env: RegionEnv) {
    this.sockets = new Sockets(ctx, LIMITS);
    this.deadMs = Number(env.DEAD_MS) || DEAD_MS;
    if (typeof WebSocketRequestResponsePair !== "undefined") ctx.setWebSocketAutoResponse?.(new WebSocketRequestResponsePair("ping", "pong"));
    if (env.LOG_WAKES) console.log(`region up with ${this.sockets.open().length} seats`);
  }

  /** Close the seats whose page stopped pinging DEAD_MS ago (on any event: the room never wakes just to look). */
  private sweep(now = Date.now()) {
    const last = this.ctx.getWebSocketAutoResponseTimestamp;
    if (!last) return;
    for (const ws of this.sockets.open()) {
      const seat = this.sockets.who(ws), at = last.call(this.ctx, ws)?.getTime() ?? seat?.since ?? now;
      if (now - at > this.deadMs) { try { ws.close(4008, "gone quiet"); } catch { /* closing */ } this.gone(ws); }
    }
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
    this.sweep();
    const name = request.headers.get("X-User-Name") || "Wanderer";
    const here = this.seats(), back = here.find((s) => s.id === id);
    if (!back && here.length >= MAX_PLAYERS) return refuseSocket(JSON.stringify({ error: "full", max: MAX_PLAYERS }), CLOSE_FULL, "full");
    const now = Date.now();
    // Back from another tab: the old socket is still open, so the seat carries on, untrusted flag and anchor too (a new
    // tab must not wipe them). Back after a drop, it was really gone: friends keep seeing the last pose, and the next one
    // starts fresh, as a new seat's does.
    const { server, response } = this.sockets.upgrade({ id, name, p: back?.p ?? {}, since: now, ...(back && { a: back.a, loose: back.loose, open: back.open }) });
    this.sockets.replace(server, (a) => a.id === id, CLOSE_REPLACED);
    const players: Player[] = here.filter((s) => s.id !== id).map((s) => ({ id: s.id, name: s.name, p: s.p }));
    this.sockets.send(server, { t: "all", you: id, age: now - WORLD_EPOCH, players });
    if (!back) this.sockets.broadcast({ t: "hi", id, name }, server);
    return response;
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    this.sweep();
    const frame = this.sockets.frame(ws, raw);
    const seat = this.sockets.who(ws);
    if (!frame || !seat) return;
    const ev = parseEvent(frame.value), others = (a: Seat) => a.id !== seat.id;
    if (ev?.e === "time") { this.sockets.send(ws, { t: "time", age: Date.now() - WORLD_EPOCH }); return; }
    if (ev?.e === "den") {
      // Against the last pose the room relayed for them (the page sends it just before the den), and against the world's
      // seed: a den nowhere near them, or one that can't hold that creature at that level, has no fight to report either.
      // A den it can't hold also forgets the one before, so no report rides on that one after a lie.
      if (seat.loose || !denNear(ev.den, seat.p) || !holds(ev.den, ev.c, ev.lv)) { if (seat.met) this.sockets.attach(ws, { ...seat, met: null }); return; }
      // The same den told again (a reconnect, or walking back in) keeps the reports already made there, so a line-up
      // still stops at six.
      const same = seat.met?.den === ev.den && seat.met.c === ev.c && Date.now() - seat.met.at < FIGHT.withinMs ? seat.met.n : 0;
      this.sockets.attach(ws, { ...seat, met: { den: ev.den, c: ev.c, lv: ev.lv, at: Date.now() - ev.ago, n: Math.max(same, ev.ago ? ev.n : 0) } });
      if (!ev.ago) this.sockets.broadcast({ t: "den", id: seat.id, den: ev.den, c: ev.c }, ws, others); // told again after a reconnect: quietly
      return;
    }
    if (ev?.e === "open") { this.sockets.attach(ws, { ...seat, open: [...new Set(ev.rs)] }); return; }
    if (ev?.e === "seen") { this.sockets.broadcast({ t: "seen", id: seat.id, picks: ev.picks, flown: ev.flown, roost: ev.roost, busy: ev.busy }, ws, others); return; }
    if (ev?.e === "life") { this.sockets.broadcast({ t: "life", id: seat.id, k: ev.k, f: ev.id, h: ev.h }, ws, others); return; }
    if (ev?.e === "hunt") {
      if (seat.loose || !huntNear(ev.h, seat.p)) return; // a board nowhere near them: no contract to tell the party about
      this.sockets.broadcast({ t: "hunt", id: seat.id, h: ev.h, s: ev.s }, ws, others);
      return;
    }
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
    // Friends always see where you are. But a jump faster than anyone walks makes the room stop vouching for where you
    // stand (no den, no contract) until you are somewhere the game sends you: an arena, a campfire or a trailhead in a
    // region you have opened, or beside a friend.
    // Trusted again: the page tells what it was refused meanwhile (contracts under way) once more.
    const now = Date.now(), p = { ...seat.p, ...d }, walk = step(seat.a, p, now);
    const loose = (!!seat.loose || walk.jumped) && !landing(p, seat.open ?? FIRST_OPEN) && !this.beside(p, seat.id);
    this.sockets.attach(ws, { ...seat, p, a: walk.a, loose });
    this.sockets.broadcast({ t: "p", id: seat.id, d }, ws, (a) => a.id !== seat.id);
    if (seat.loose && !loose) this.sockets.send(ws, { t: "vouch" });
  }

  /** Is pose `p` beside someone else in the room the room vouches for? */
  private beside(p: Delta, id: string): boolean {
    if (p.x === undefined || p.z === undefined) return false;
    return this.seats().some((s) => s.id !== id && !s.loose && s.p.r === p.r && s.p.x !== undefined && s.p.z !== undefined && Math.hypot(s.p.x - p.x!, s.p.z - p.z!) / 10 < BESIDE_M);
  }

  webSocketClose(ws: RoomSocket) { this.gone(ws); }
  webSocketError(ws: RoomSocket) { this.gone(ws); }

  /** Sockets already told about: a swept one closes later too, and its friends should hear "bye" once. */
  private left = new WeakSet<RoomSocket>();
  private gone(ws: RoomSocket) {
    if (this.left.has(ws)) return;
    this.left.add(ws);
    const id = this.sockets.who(ws)?.id;
    if (id && !this.sockets.others(ws, (a) => a.id === id).length) this.sockets.broadcast({ t: "bye", id }, ws);
  }
}
