// What every game builds after Qollab says "start" (#3878): a door that decides who someone is, a seat per player
// bound to that id (eqosys account or guest), a second tab or a reconnect taking the seat over, a player leaving only
// when their last socket goes, and a loop that runs while anyone is here. A game's world keeps its Durable Object
// shape and its own tick and sync; it swaps `Sockets` for `Seats` and its edge's door for `seatDoor`.
//
// This is a library each game's own Worker and DO run, not a Qollab service: after "start" the game never calls
// Qollab, so moving Qollab to its own Worker (#3816) changes nothing here, and a game's data stays in the game (#3168).
import { sha256 } from "./bytes.ts";
import { originAllowed, type RoomMintGate } from "./limits.ts";
import { Sockets, type RoomLimits, type RoomCtx, type RoomSocket } from "./room.ts";
import { SEAT_CLOSE } from "./socket.ts";
import { whoIs, type Door } from "./token.ts";

export { SEAT_CLOSE };

/** The id players know each other by: a one-way hash of the vouched login, salted with the app, so nobody can lift another's. */
export const publicId = async (app: string, uid: string): Promise<string> => (await sha256(`${app}:${uid}`)).slice(0, 16);

// ---------- the edge: the one place identity is decided ----------

export interface SeatDoor {
  door: Door;
  /** What a room code looks like (upper-cased before the test). */
  room: RegExp;
  /** New rooms a minute from one address (per isolate, keyed by CF-Connecting-IP). */
  gate: RoomMintGate;
}

/**
 * A game Worker's /ws, before its world sees it: a websocket from the page's own origin, a room code, and who it is
 * (`whoIs`: an eqosys token, else a guest uid). The client's own `X-*` headers are stripped and the Worker vouches
 * X-User-Id, X-User-Name and X-RB-Principal "guest" (online, nobody is the desktop host). The game picks the world
 * from `room` (and anything else in the query) and sends it `request`.
 */
export async function seatDoor(req: Request, d: SeatDoor): Promise<{ room: string; url: URL; request: Request } | Response> {
  const url = new URL(req.url);
  if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 426 });
  if (!originAllowed(req.headers.get("Origin"), url)) return new Response("cross-origin websocket refused", { status: 403 });
  const room = (url.searchParams.get("room") ?? "").toUpperCase();
  if (!d.room.test(room)) return new Response("bad room code", { status: 400 });
  const who = await whoIs(url, d.door);
  if (who instanceof Response) return who;
  const ip = req.headers.get("CF-Connecting-IP");
  if (ip && !d.gate.allow(ip, room, Date.now())) return new Response("too many new rooms, try again in a minute", { status: 429 });
  const headers = new Headers(req.headers);
  for (const k of [...headers.keys()]) if (k.toLowerCase().startsWith("x-")) headers.delete(k); // never a client's word
  headers.set("X-User-Id", who.uid);
  headers.set("X-User-Name", who.name);
  headers.set("X-RB-Principal", "guest");
  return { room, url, request: new Request(req, { headers }) };
}

// ---------- the world: seats on its sockets ----------

/** Who a world's upgrade is from, as its edge (or the desktop host) vouched it. */
export interface Vouched {
  /** The login itself: keys the seat inside the world, never sent to anyone. */
  uid: string;
  /** `publicId(app, uid)`: what views and other players see. */
  id: string;
  name: string;
  /** The desktop host's own page (the host's shell sets no "guest" principal). Never true online. */
  host: boolean;
}

/** The upgrade's vouched player, or the refusal: not a websocket (400), no vouched id (401). */
export async function vouched(req: Request, app: string, fallbackName: string): Promise<Vouched | Response> {
  if (req.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
  const uid = req.headers.get("X-User-Id");
  if (!uid) return new Response("Unauthenticated", { status: 401 });
  return { uid, id: await publicId(app, uid), name: (req.headers.get("X-User-Name") || fallbackName).slice(0, 24), host: req.headers.get("X-RB-Principal") !== "guest" };
}

/** A seat's attachment carries at least the key it is held by. */
export interface Seat { id: string }

/**
 * `Sockets` where each attachment is one player's seat, keyed by `id`. One socket per player: `take` puts the new one
 * in and closes the older ones with SEAT_CLOSE.replaced, and `leave` says when the player is really gone.
 */
export class Seats<A extends Seat, Out = unknown> extends Sockets<A, Out> {
  private left = new WeakSet<RoomSocket>();

  constructor(ctx: RoomCtx, limits?: RoomLimits) { super(ctx, limits); }

  /** The upgrade for `seat`. `back`: the player already had a socket open here (another tab), so the game shouldn't greet them again. */
  take(seat: A, tags?: string[]): { server: RoomSocket; response: Response; back: boolean } {
    const { server, response } = this.upgrade(seat, tags);
    const back = this.others(server, (a) => a.id === seat.id).length > 0;
    this.replace(server, (a) => a.id === seat.id, SEAT_CLOSE.replaced);
    return { server, response, back };
  }

  /** A socket closed or errored: the id of a player who has no other socket left, once per socket, else null. */
  leave(ws: RoomSocket): string | null {
    if (this.left.has(ws)) return null;
    this.left.add(ws);
    const id = this.who(ws)?.id;
    return id && !this.others(ws, (a) => a.id === id).length ? id : null;
  }

  /** Each seated player once (their newest socket's attachment): who is here. */
  here(): A[] {
    const by = new Map<string, A>();
    for (const ws of this.open()) { const a = this.who(ws); if (a) by.set(a.id, a); }
    return [...by.values()];
  }
}

/** A world's tick that runs only while someone is here: `start` on a join (twice is once), `stop` once the room empties. */
export class Loop {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private ms: number, private tick: () => void) {}
  get running(): boolean { return this.timer !== null; }
  start() { if (!this.timer) this.timer = setInterval(this.tick, this.ms); }
  stop() { if (this.timer) clearInterval(this.timer), (this.timer = null); }
}
