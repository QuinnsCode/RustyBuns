// Walking the world together (#3663), the rules both ends share: what a player's pose is on the wire, how the page
// cuts it down before sending, and how it draws the others smoothly from a few updates a second. Pure, so the
// region's Durable Object (edge/region.ts), the page (net/online.ts), the cost model and the tests run the same code.
//
// The wire is small on purpose: a pose is whole decimetres and a 256th of a turn, and a message carries only the
// fields that changed since the last one. Nobody sends a frame per frame: SEND_MS apart at most, and nothing at all
// while you stand still, so a party standing at a campfire costs nothing and lets the room hibernate.
import { clamp } from "@rustybuns/util";
import { arr, Bad, check, int, obj, oneOf, opt, str, type Guard } from "@rustybuns/util/guard";

/** Players in one region's room: a hunting party, not a crowd. */
export const MAX_PLAYERS = 6;
/** The page sends at most this often (5 Hz). */
export const SEND_MS = 200;
/** Others are drawn this far in the past, so there are two updates to blend between. */
export const BEHIND_MS = 250;

/** Whole decimetres east and south, a 256th of a turn, the region you are in, the creature you walk as, and the next two of
 *  your line-up who follow you (`f`, comma-joined; empty for none). */
export interface Pose { r: number; x: number; z: number; y: number; l: string; f: string }
export type Delta = Partial<Pose>;

/** The continent is 77 x 51 km: a decimetre grid fits in an int that JSON spells in six digits. */
const SPAN = 1_000_000;
const ID = /^[a-z0-9-]{1,40}$/;
/** The followers shown behind a friend. */
export const FOLLOWERS = 2;
const POSE = { r: int(1, 64), x: int(0, SPAN), z: int(0, SPAN), y: int(0, 255), l: str(40, { re: ID }), f: str(81, { min: 0, re: /^([a-z0-9-]{1,40}(,[a-z0-9-]{1,40})?)?$/ }) };
const DELTA: Guard<Delta> = obj({ r: opt(POSE.r), x: opt(POSE.x), z: opt(POSE.z), y: opt(POSE.y), l: opt(POSE.l), f: opt(POSE.f) });
const FULL: Guard<Pose> = obj(POSE);
const KEYS = ["r", "x", "z", "y", "l", "f"] as const;

/** A delta off the wire, or null when it isn't one (an unknown field, a number off the map, an empty message). */
export function parseDelta(raw: unknown): Delta | null {
  const d = check(DELTA, raw);
  if (!d) return null;
  const out: Delta = {};
  for (const k of KEYS) if (d[k] !== undefined) (out as Record<string, unknown>)[k] = d[k];
  return Object.keys(out).length ? out : null;
}

/** A pose once every field has arrived, else null (a player is drawn only once we know where and as what). */
export const whole = (p: Delta): Pose | null => check(FULL, p);

/** Metres and radians (yaw 0 is +x, the world's own) to the wire's grid. */
export function quantise(region: number, x: number, z: number, yaw: number, lead: string, follow: readonly string[] = []): Pose {
  const turn = (((yaw / (2 * Math.PI)) % 1) + 1) % 1;
  return { r: region, x: Math.round(clamp(x * 10, 0, SPAN)), z: Math.round(clamp(z * 10, 0, SPAN)), y: Math.round(turn * 256) % 256, l: lead, f: follow.slice(0, FOLLOWERS).join(",") };
}
export const metres = (p: Pose) => ({ x: p.x / 10, z: p.z / 10, yaw: (p.y / 256) * 2 * Math.PI });

/** What changed from `was` to `now`, or null when nothing did. */
export function delta(was: Pose | null, now: Pose): Delta | null {
  if (!was) return { ...now };
  const d: Delta = {};
  for (const k of KEYS) if (was[k] !== now[k]) (d as Record<string, unknown>)[k] = now[k];
  return Object.keys(d).length ? d : null;
}

/** A wild one's den as the world names it (`12,34`, `hunt:<id>`) and the creature in it. */
const DEN = /^[a-z0-9:,_-]{1,48}$/;
/** Walked into a wild one: the page tells the room, and the room tells the party, so that den is busy for everyone. */
export interface Met { e: "den"; den: string; c: string }
const MET: Guard<Met> = obj({ e: oneOf(["den"]), den: str(48, { re: DEN }), c: POSE.l });
export const parseMet = (raw: unknown): Met | null => check(MET, raw);

/** Someone else in the room as the room tells it: a one-way id, the name they go by, and what we know of their pose. */
export interface Player { id: string; name: string; p: Delta }
/** The room to a page. `all` on joining (with `age`: ms since the room's clock started), then `hi` / `p` / `den` / `bye`
 * as people come, move, fight and go. */
export type ServerMsg =
  | { t: "all"; you: string; age: number; players: Player[] }
  | { t: "hi"; id: string; name: string }
  | { t: "p"; id: string; d: Delta }
  | { t: "den"; id: string; den: string; c: string }
  | { t: "bye"; id: string };

/** The room's clock started `age` ms before we heard it at `heard` (performance.now()): seconds on it at `now`. The world's
 *  wilds, sun and weather all turn on this one number, so a party sees the same world; latency is the only error. */
export const worldClock = (age: number, heard: number, now: number) => (age + now - heard) / 1000;

const PID = str(32, { re: /^[0-9a-f]{1,32}$/ });
const NAME = str(24, { min: 0 });
/** A player who hasn't moved yet has no pose: an empty one, not a refused message. */
const PLAYER = obj({ id: PID, name: NAME, p: (v: unknown) => parseDelta(v) ?? {} });
const SERVER: Guard<ServerMsg> = (v) => {
  const t = typeof v === "object" && v !== null && "t" in v ? v.t : undefined;
  if (t === "all") return obj({ t: oneOf(["all"]), you: PID, age: int(0, 1e12), players: arr(PLAYER, MAX_PLAYERS) })(v);
  if (t === "den") return obj({ t: oneOf(["den"]), id: PID, den: str(48, { re: DEN }), c: POSE.l })(v);
  if (t === "hi") return obj({ t: oneOf(["hi"]), id: PID, name: NAME })(v);
  if (t === "bye") return obj({ t: oneOf(["bye"]), id: PID })(v);
  return obj({ t: oneOf(["p"]), id: PID, d: (x: unknown) => parseDelta(x) ?? bad("a pose") })(v);
};
const bad = (why: string): never => { throw new Bad(why); };
/** A room message read on the page, every pose through parseDelta. */
export const decodeServer = (raw: unknown): ServerMsg | null => check(SERVER, raw);

/** One other player as the page draws them: updates in, a smooth place out. */
export class Ghost {
  pose: Delta = {};
  private samples: { at: number; x: number; z: number; yaw: number }[] = [];
  constructor(readonly id: string, public name: string) {}

  /** Fold in a delta that arrived at `at` (ms). */
  hear(d: Delta, at: number) {
    const was = this.pose.r;
    Object.assign(this.pose, d);
    const p = whole(this.pose);
    if (!p) return;
    const m = metres(p);
    // A new region is a new place: no gliding across the map from the old one.
    if (was !== undefined && d.r !== undefined && d.r !== was) this.samples = [];
    this.samples.push({ at, ...m });
    if (this.samples.length > 8) this.samples.shift();
  }

  /** Where to draw them at `now`: BEHIND_MS in the past between two updates. Past the newest one they stand where it
   *  put them: a page sends while it moves, so no update for BEHIND_MS means they stopped there (no coasting past it). */
  at(now: number): { x: number; z: number; yaw: number; region: number; lead: string; follow: string[] } | null {
    const p = whole(this.pose), s = this.samples;
    if (!p || !s.length) return null;
    const t = now - BEHIND_MS, last = s[s.length - 1]!;
    const out = (x: number, z: number, yaw: number) => ({ x, z, yaw, region: p.r, lead: p.l, follow: p.f ? p.f.split(",") : [] });
    if (t <= s[0]!.at) return out(s[0]!.x, s[0]!.z, s[0]!.yaw);
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1]!, b = s[i]!;
      if (t >= a.at && t <= b.at) { const k = (t - a.at) / Math.max(1, b.at - a.at); return out(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k, turnTo(a.yaw, b.yaw, k)); }
    }
    return out(last.x, last.z, last.yaw);
  }
}

/** From yaw a to b the short way round, k of the way. */
function turnTo(a: number, b: number, k: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}
