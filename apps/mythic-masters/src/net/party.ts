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
/** Past its last update a player keeps walking the way it went for at most this long (dead reckoning), then stops. */
export const COAST_MS = 400;

/** Whole decimetres east and south, a 256th of a turn, the region you are in and the creature you walk as. */
export interface Pose { r: number; x: number; z: number; y: number; l: string }
export type Delta = Partial<Pose>;

/** The continent is 77 x 51 km: a decimetre grid fits in an int that JSON spells in six digits. */
const SPAN = 1_000_000;
const ID = /^[a-z0-9-]{1,40}$/;
const POSE = { r: int(1, 64), x: int(0, SPAN), z: int(0, SPAN), y: int(0, 255), l: str(40, { re: ID }) };
const DELTA: Guard<Delta> = obj({ r: opt(POSE.r), x: opt(POSE.x), z: opt(POSE.z), y: opt(POSE.y), l: opt(POSE.l) });
const FULL: Guard<Pose> = obj(POSE);

/** A delta off the wire, or null when it isn't one (an unknown field, a number off the map, an empty message). */
export function parseDelta(raw: unknown): Delta | null {
  const d = check(DELTA, raw);
  if (!d) return null;
  const out: Delta = {};
  for (const k of ["r", "x", "z", "y", "l"] as const) if (d[k] !== undefined) (out as Record<string, unknown>)[k] = d[k];
  return Object.keys(out).length ? out : null;
}

/** A pose once every field has arrived, else null (a player is drawn only once we know where and as what). */
export const whole = (p: Delta): Pose | null => check(FULL, p);

/** Metres and radians (yaw 0 is +x, the world's own) to the wire's grid. */
export function quantise(region: number, x: number, z: number, yaw: number, lead: string): Pose {
  const turn = (((yaw / (2 * Math.PI)) % 1) + 1) % 1;
  return { r: region, x: Math.round(clamp(x * 10, 0, SPAN)), z: Math.round(clamp(z * 10, 0, SPAN)), y: Math.round(turn * 256) % 256, l: lead };
}
export const metres = (p: Pose) => ({ x: p.x / 10, z: p.z / 10, yaw: (p.y / 256) * 2 * Math.PI });

/** What changed from `was` to `now`, or null when nothing did. */
export function delta(was: Pose | null, now: Pose): Delta | null {
  if (!was) return { ...now };
  const d: Delta = {};
  for (const k of ["r", "x", "z", "y", "l"] as const) if (was[k] !== now[k]) (d as Record<string, unknown>)[k] = now[k];
  return Object.keys(d).length ? d : null;
}

/** Someone else in the room as the room tells it: a one-way id, the name they go by, and what we know of their pose. */
export interface Player { id: string; name: string; p: Delta }
/** The room to a page. `all` on joining, then `hi` / `p` / `bye` as people come, move and go. */
export type ServerMsg =
  | { t: "all"; you: string; players: Player[] }
  | { t: "hi"; id: string; name: string }
  | { t: "p"; id: string; d: Delta }
  | { t: "bye"; id: string };

const PID = str(32, { re: /^[0-9a-f]{1,32}$/ });
const NAME = str(24, { min: 0 });
/** A player who hasn't moved yet has no pose: an empty one, not a refused message. */
const PLAYER = obj({ id: PID, name: NAME, p: (v: unknown) => parseDelta(v) ?? {} });
const SERVER: Guard<ServerMsg> = (v) => {
  const t = typeof v === "object" && v !== null && "t" in v ? v.t : undefined;
  if (t === "all") return obj({ t: oneOf(["all"]), you: PID, players: arr(PLAYER, MAX_PLAYERS) })(v);
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

  /** Where to draw them at `now`: BEHIND_MS in the past between two updates, or coasting a little past the last. */
  at(now: number): { x: number; z: number; yaw: number; region: number; lead: string } | null {
    const p = whole(this.pose), s = this.samples;
    if (!p || !s.length) return null;
    const t = now - BEHIND_MS, last = s[s.length - 1]!;
    const out = (x: number, z: number, yaw: number) => ({ x, z, yaw, region: p.r, lead: p.l });
    if (t <= s[0]!.at) return out(s[0]!.x, s[0]!.z, s[0]!.yaw);
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1]!, b = s[i]!;
      if (t >= a.at && t <= b.at) { const k = (t - a.at) / Math.max(1, b.at - a.at); return out(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k, turnTo(a.yaw, b.yaw, k)); }
    }
    // Past the newest update: keep going the way they went, for a moment.
    const prev = s[s.length - 2];
    if (!prev) return out(last.x, last.z, last.yaw);
    const over = Math.min(t - last.at, COAST_MS), span = Math.max(1, last.at - prev.at);
    return out(last.x + ((last.x - prev.x) / span) * over, last.z + ((last.z - prev.z) / span) * over, last.yaw);
  }
}

/** From yaw a to b the short way round, k of the way. */
function turnTo(a: number, b: number, k: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}
