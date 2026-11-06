// Walking the world together (#3663), the rules both ends share: what a player's pose is on the wire, how the page
// cuts it down before sending, and how it draws the others smoothly from a few updates a second. Pure, so the
// region's Durable Object (edge/region.ts), the page (net/online.ts), the cost model and the tests run the same code.
//
// The wire is small on purpose: a pose is whole decimetres and a 256th of a turn, and a message carries only the
// fields that changed since the last one. Nobody sends a frame per frame: SEND_MS apart at most, and nothing at all
// while you stand still, so a party standing at a campfire costs nothing and lets the room hibernate.
import { clamp } from "@rustybuns/util";
import { arr, Bad, bool, check, int, num, obj, oneOf, opt, str, type Guard } from "@rustybuns/util/guard";

/** Players in one region's room: a hunting party, not a crowd. */
export const MAX_PLAYERS = 6;
/** The page sends at most this often (5 Hz). */
export const SEND_MS = 200;
/** Others are drawn this far in the past, so there are two updates to blend between. */
export const BEHIND_MS = 250;
/** A friend still on the move whose next update is late keeps walking the way they went for at most this long (dead
 *  reckoning); one whose last update said they stopped is held there. */
export const COAST_MS = 300;

/** Whole decimetres east and south, a 256th of a turn, the region you are in, the creature you walk as, the next two of
 *  your line-up who follow you (`f`, comma-joined; empty for none), and whether you are on the move (`m`, 1 or 0: the
 *  message that stops you carries where you stopped and `m: 0`, so a friend's page knows not to coast past it). */
export interface Pose { r: number; x: number; z: number; y: number; l: string; f: string; m: number }
export type Delta = Partial<Pose>;

/** The continent is 77 x 51 km: a decimetre grid fits in an int that JSON spells in six digits. */
const SPAN = 1_000_000;
const ID = /^[a-z0-9-]{1,40}$/;
/** The followers shown behind a friend. */
export const FOLLOWERS = 2;
const POSE = { r: int(1, 64), x: int(0, SPAN), z: int(0, SPAN), y: int(0, 255), l: str(40, { re: ID }), f: str(81, { min: 0, re: /^([a-z0-9-]{1,40}(,[a-z0-9-]{1,40})?)?$/ }), m: int(0, 1) };
const DELTA: Guard<Delta> = obj({ r: opt(POSE.r), x: opt(POSE.x), z: opt(POSE.z), y: opt(POSE.y), l: opt(POSE.l), f: opt(POSE.f), m: opt(POSE.m) });
const FULL: Guard<Pose> = obj(POSE);
const KEYS = ["r", "x", "z", "y", "l", "f", "m"] as const;

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
export function quantise(region: number, x: number, z: number, yaw: number, lead: string, follow: readonly string[] = [], moving = false): Pose {
  const turn = (((yaw / (2 * Math.PI)) % 1) + 1) % 1;
  return { r: region, x: Math.round(clamp(x * 10, 0, SPAN)), z: Math.round(clamp(z * 10, 0, SPAN)), y: Math.round(turn * 256) % 256, l: lead, f: follow.slice(0, FOLLOWERS).join(","), m: moving ? 1 : 0 };
}
export const metres = (p: Pose) => ({ x: p.x / 10, z: p.z / 10, yaw: (p.y / 256) * 2 * Math.PI });

/** What changed from `was` to `now`, or null when nothing did. */
export function delta(was: Pose | null, now: Pose): Delta | null {
  if (!was) return { ...now };
  const d: Delta = {};
  for (const k of KEYS) if (was[k] !== now[k]) (d as Record<string, unknown>)[k] = now[k];
  return Object.keys(d).length ? d : null;
}

/** A wild one's den as the world names it (`12,34`, `hunt:1.20002.6206`) and the creature in it. */
const DEN = /^[a-z0-9:.,_-]{1,48}$/;
/** A sighting board's contract (src/world/hunts.ts ids, `1.20002.6206`). */
const HUNT = /^[0-9.]{1,32}$/;
/** A flock's or a food patch's grid cell (src/world/nature.ts ids). */
const CELL = /^-?[0-9]{1,6},-?[0-9]{1,6}$/;
/** A den told again after a reconnect is at most this old: a fight of up to 2 min and a minute to get back. */
export const AGO_MS = 3 * 60_000;
/** A line-up fights a den one beast after another: at most this many reports per den (FIGHT.perDen). */
const FIGHT_PER_DEN = 6;
/** What a newcomer should know: the patches picked lately and the flocks up (with their world-clock times), the flocks
 *  that have landed somewhere new, and the dens a friend is busy at. */
export interface Seen { picks: { id: string; at: number }[]; flown: { id: string; at: number; h: number }[]; roost: { id: string; x: number; z: number }[]; busy: string[] }
const SEEN = {
  picks: arr(obj({ id: str(24, { re: CELL }), at: num(0, 7200) }), 30),
  flown: arr(obj({ id: str(24, { re: CELL }), at: num(0, 7200), h: num(-10, 10, 0) }), 30),
  roost: arr(obj({ id: str(24, { re: CELL }), x: num(0, 100_000), z: num(0, 100_000) }), 30, { min: 0 }),
  busy: arr(str(48, { re: DEN }), 12, { min: 0 }),
};
/** The signs of a contract (hunts.ts CLUES); a friend's progress is never shared past the lair. */
export const SIGNS = 3;

/** What a page tells the room besides its pose:
 * - `den`: walked into a wild one (the page sends its pose just before, and the room checks the den against it), so that
 *   den is busy for everyone (a lair stays open, so friends can join the hunt); `ago` > 0 (at most AGO_MS) is the same
 *   den told again after a reconnect, quietly, for the fight report;
 * - `seen`: the patches picked and flocks flushed lately, with their world-clock times, at once, for a friend who just
 *   arrived, so their bushes regrow and their birds land on the same tick as yours;
 * - `time`: what is the world clock now? (the room answers with `time`, a sample for the page to keep the best of);
 * - `hunt`: took a contract (`s` 0) or read its `s`-th sign, so the party can follow it to the lair;
 * - `fought`: a fight it started at a den ended (`s` seconds of it), for the room to check and tell the party;
 * - `life`: it flushed a flock (taking off on heading `h`) or picked a food patch, so the party's birds and bushes match;
 * - `open`: the regions its save has opened (on joining, and when one opens), so a jump is believed only at a landing
 *   spot in one of them (dens.ts `landing`). A claim, but it bounds a lie to what the page says it has. */
export type Event =
  | { e: "den"; den: string; c: string; lv: number; ago: number; n: number }
  | { e: "seen" } & Seen
  | { e: "time" }
  | { e: "hunt"; h: string; s: number }
  | { e: "fought"; c: string; lv: number; won: boolean; bound: boolean; s: number }
  | { e: "life"; k: "flush" | "pick"; id: string; h: number }
  | { e: "open"; rs: number[] };
export type Met = Extract<Event, { e: "den" }>;
const EVENT: Guard<Event> = (v) => {
  const e = typeof v === "object" && v !== null && "e" in v ? v.e : undefined;
  if (e === "life") return obj({ e: oneOf(["life"]), k: oneOf(["flush", "pick"]), id: str(24, { re: CELL }), h: num(-10, 10, 0) })(v);
  if (e === "hunt") return obj({ e: oneOf(["hunt"]), h: str(32, { re: HUNT }), s: int(0, SIGNS) })(v);
  if (e === "fought") return obj({ e: oneOf(["fought"]), c: POSE.l, lv: int(1, 200), won: bool(), bound: bool(), s: int(0, 3600) })(v);
  if (e === "open") return obj({ e: oneOf(["open"]), rs: arr(POSE.r, 64) })(v);
  if (e === "time") return obj({ e: oneOf(["time"]) })(v);
  if (e === "seen") return obj({ e: oneOf(["seen"]), ...SEEN })(v);
  return obj({ e: oneOf(["den"]), den: str(48, { re: DEN }), c: POSE.l, lv: int(1, 200), ago: int(0, AGO_MS, 0), n: int(0, FIGHT_PER_DEN, 0) })(v);
};
export const parseEvent = (raw: unknown): Event | null => check(EVENT, raw);

/** A fight report is believed when the same player walked into that creature's den, at that level, at least as long ago
 *  as the fight says it lasted (less a little for clocks; after a first report, as long ago as that one), within a quarter
 *  of an hour, and the fight lasted 3 s to 2 min (a round is 99 s). A line-up fights a den one beast after another, so a
 *  den gives up to `perDen` reports. Anything else is dropped, never relayed. */
export const FIGHT = { minS: 3, maxS: 120, slackMs: 2_000, withinMs: 15 * 60_000, perDen: FIGHT_PER_DEN } as const;
export interface MetAt { den?: string; c: string; lv: number; at: number; n: number }
export function plausible(met: MetAt | null | undefined, f: Extract<Event, { e: "fought" }>, now: number): boolean {
  if (!met || met.c !== f.c || met.lv !== f.lv || met.n >= FIGHT.perDen || f.s < FIGHT.minS || f.s > FIGHT.maxS) return false;
  const since = now - met.at;
  return since >= f.s * 1000 - FIGHT.slackMs && since <= FIGHT.withinMs;
}

/** The fastest anyone moves on foot, in metres a second: the quickest beast's top speed (roster.ts, 11 m/s), a fifth up
 *  when you walk as it, doubled when you run (world/view.ts). */
export const RUN_MPS = 27;
/** Room for clocks, bunched messages and decimetres: a pose may be this much further on than RUN_MPS allows. */
const JUMP_SLACK_M = 40;
/** Did a player get from pose `was` to `now` in `ms` faster than anyone walks? Travel, fast travel, being sent home and
 *  landing beside a friend all do; the room believes such a jump only where it lands somewhere the game sends you. */
export function jumped(was: Delta | null | undefined, now: Delta, ms: number, slack = JUMP_SLACK_M): boolean {
  if (was?.x === undefined || was.z === undefined || now.x === undefined || now.z === undefined) return false;
  return Math.hypot(now.x - was.x, now.z - was.z) / 10 > (RUN_MPS * Math.max(0, ms)) / 1000 + slack;
}

/** The last pose the room trusts and when it was sent, in decimetres like a pose. */
export interface Anchor { x: number; z: number; at: number }
/** The room's speed check, measured from a trusted anchor, not from the pose before. Each pose is checked against the
 *  anchor with JUMP_SLACK_M of room. The anchor moves up to a pose only when the walk there fits with no slack at all,
 *  and its clock moves on only by the time that walk takes at RUN_MPS, so time banked during a network stall carries
 *  through the burst of poses that follows it. The slack is spent once: many small hops in a row (39 m each, at once) are
 *  caught by the second. A pose that isn't a jump but leans on the slack keeps the old anchor, and the next pose has the
 *  extra time to catch up. */
export function step(a: Anchor | undefined, p: Delta, now: number): { a: Anchor | undefined; jumped: boolean } {
  if (p.x === undefined || p.z === undefined) return { a, jumped: false };
  if (!a) return { a: { x: p.x, z: p.z, at: now }, jumped: false };
  if (jumped(a, p, now - a.at)) return { a: { x: p.x, z: p.z, at: now }, jumped: true };
  if (jumped(a, p, now - a.at, 0)) return { a, jumped: false };
  const took = (Math.hypot(p.x - a.x, p.z - a.z) / 10 / RUN_MPS) * 1000;
  return { a: { x: p.x, z: p.z, at: Math.min(now, a.at + took) }, jumped: false };
}

/** Is the contract `h` (`n.x.z`: its board's region and place) one this player could be on, by their last pose? In their
 *  region, its board within 2 km (the lair is three signs of about 220 m on). */
export function huntNear(h: string, p: Delta): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m || p.r === undefined || p.x === undefined || p.z === undefined) return false;
  return +m[1]! === p.r && Math.hypot(+m[2]! - p.x / 10, +m[3]! - p.z / 10) < 2000;
}

/** Grid sizes of food patches and flocks' roosts, in metres (FORAGE_GRID and FLOCK_GRID in src/world/nature.ts, which
 *  the room can't import: it pulls in the whole world). */
const WILD_GRID = { pick: 70, flush: 110 };
/** How far from its cell's middle a player can be to pick it (inside its cell, plus a pose up to a send behind), or to
 *  flush a flock (a flushed flock lands up to a flight off, 110 m, and can be flushed again from there, so a few flights' worth). */
const WILD_M = { pick: 120, flush: 1000 };

/** Could a player at pose `p` have picked the patch or flushed the flock in grid cell `cell` (`gx,gz`)? */
export function wildNear(k: "pick" | "flush", cell: string, p: Delta): boolean {
  const m = /^(-?\d+),(-?\d+)$/.exec(cell);
  if (!m || p.x === undefined || p.z === undefined) return false;
  const g = WILD_GRID[k];
  return Math.hypot((+m[1]! + 0.5) * g - p.x / 10, (+m[2]! + 0.5) * g - p.z / 10) < WILD_M[k];
}

/** The world's clock starts here for every room at once, so walking into a new region or rejoining never resets it. */
export const WORLD_EPOCH = Date.UTC(2026, 10, 1);
/** It wraps every five game days (world/nature.ts DAY is 24 minutes): the sun lands where it was, every page wraps on the
 *  same tick, and the number stays small enough for the shaders' float32 time (plant sway, ripples) to keep moving smoothly. */
export const WORLD_CYCLE = 5 * 24 * 60;

/** Someone else in the room as the room tells it: a one-way id, the name they go by, and what we know of their pose. */
export interface Player { id: string; name: string; p: Delta }
/** The room to a page. `all` on joining (with `age`: ms on the world clock, since WORLD_EPOCH by the room's time), then
 * `hi` / `p` / `den` / `hunt` / `fought` / `bye` as people come, move, fight, track and go. `vouch` is to you alone: the room
 * trusts where you stand again after a jump, so tell it again what it dropped meanwhile. */
export type ServerMsg =
  | { t: "all"; you: string; age: number; players: Player[] }
  | { t: "hi"; id: string; name: string }
  | { t: "p"; id: string; d: Delta }
  | { t: "den"; id: string; den: string; c: string }
  | { t: "hunt"; id: string; h: string; s: number }
  | { t: "fought"; id: string; c: string; lv: number; won: boolean; bound: boolean }
  | { t: "life"; id: string; k: "flush" | "pick"; f: string; h: number }
  | { t: "time"; age: number }
  | { t: "vouch" }
  | ({ t: "seen"; id: string } & Seen)
  | { t: "bye"; id: string };

/** The world clock read `age` ms when we heard it at `heard` (performance.now()): seconds on it at `now`. The world's
 *  wilds, sun and weather all turn on this one number, so a party sees the same world; latency is the only error. */
export const worldClock = (age: number, heard: number, now: number) => ((age + now - heard) / 1000) % WORLD_CYCLE;
/** The best of several clock samples: a page busy when one arrives reads it late, which only ever makes its offset
 *  (world time minus page time) smaller, so the largest offset seen is the truest. */
export const bestOffset = (samples: readonly { age: number; at: number }[]) => Math.max(...samples.map((s) => s.age - s.at));

const PID = str(32, { re: /^[0-9a-f]{1,32}$/ });
const NAME = str(24, { min: 0 });
/** A player who hasn't moved yet has no pose: an empty one, not a refused message. */
const PLAYER = obj({ id: PID, name: NAME, p: (v: unknown) => parseDelta(v) ?? {} });
const SERVER: Guard<ServerMsg> = (v) => {
  const t = typeof v === "object" && v !== null && "t" in v ? v.t : undefined;
  if (t === "all") return obj({ t: oneOf(["all"]), you: PID, age: int(0, 1e12), players: arr(PLAYER, MAX_PLAYERS) })(v);
  if (t === "den") return obj({ t: oneOf(["den"]), id: PID, den: str(48, { re: DEN }), c: POSE.l })(v);
  if (t === "seen") return obj({ t: oneOf(["seen"]), id: PID, ...SEEN })(v);
  if (t === "time") return obj({ t: oneOf(["time"]), age: int(0, 1e12) })(v);
  if (t === "life") return obj({ t: oneOf(["life"]), id: PID, k: oneOf(["flush", "pick"]), f: str(24, { re: CELL }), h: num(-10, 10, 0) })(v);
  if (t === "hunt") return obj({ t: oneOf(["hunt"]), id: PID, h: str(32, { re: HUNT }), s: int(0, SIGNS) })(v);
  if (t === "fought") return obj({ t: oneOf(["fought"]), id: PID, c: POSE.l, lv: int(1, 200), won: bool(), bound: bool() })(v);
  if (t === "hi") return obj({ t: oneOf(["hi"]), id: PID, name: NAME })(v);
  if (t === "bye") return obj({ t: oneOf(["bye"]), id: PID })(v);
  if (t === "vouch") return obj({ t: oneOf(["vouch"]) })(v);
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

  /** Where to draw them at `now`: BEHIND_MS in the past between two updates. Past the newest, a friend whose last update
   *  said they stopped stands there; one still moving coasts on a little (a late update), never past COAST_MS. */
  at(now: number): { x: number; z: number; yaw: number; region: number; lead: string; follow: string[] } | null {
    // (after the newest update: held there if it said they stopped, else coasting COAST_MS on the way they went)
    const p = whole(this.pose), s = this.samples;
    if (!p || !s.length) return null;
    const t = now - BEHIND_MS, last = s[s.length - 1]!;
    const out = (x: number, z: number, yaw: number) => ({ x, z, yaw, region: p.r, lead: p.l, follow: p.f ? p.f.split(",") : [] });
    if (t <= s[0]!.at) return out(s[0]!.x, s[0]!.z, s[0]!.yaw);
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1]!, b = s[i]!;
      if (t >= a.at && t <= b.at) { const k = (t - a.at) / Math.max(1, b.at - a.at); return out(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k, turnTo(a.yaw, b.yaw, k)); }
    }
    const prev = s[s.length - 2];
    if (!p.m || !prev) return out(last.x, last.z, last.yaw);
    const over = Math.min(t - last.at, COAST_MS), span = Math.max(1, last.at - prev.at);
    return out(last.x + ((last.x - prev.x) / span) * over, last.z + ((last.z - prev.z) / span) * over, last.yaw);
  }
}

/** From yaw a to b the short way round, k of the way. */
function turnTo(a: number, b: number, k: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}
