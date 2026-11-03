// The fight, as a deterministic fixed-step sim (60 Hz). No DOM, no three.js: the page and the
// bot-vs-bot tuner (scripts/tune.ts) both drive `step` with one Input per fighter per tick.
//
// Rules worth knowing before tuning:
// - Mass is felt: knockback divides by it, armour on heavy bodies shrugs off light hits mid-swing.
// - Nothing hides in the air: flight drains stamina (out of it, you fall), the ceiling is low, every
//   creature's launcher reaches up, a column pitches up at a flyer, and a heavy hit on a flyer clips its wings.
// - Ranged moves are shapes (moves.ts `Delivery`, docs/ATTACKS.md): a column, wall, cone, blast or nova, aimed where
//   the target stood when you pressed. Nothing homes, so a sidestep out of a narrow column or a step off a blast's
//   ring is a real dodge; your own blast hits you too if you stand where it lands.
// - A flyer's heavy with down held is a dive: it drops on the target and stays live until it lands,
//   so it pays to come down: one that lands bounces back up out of reach, one that misses recovers on
//   the ground next to whatever it missed.
// - Tight, the way a platform fighter is: a press while you're busy is kept for BUFFER frames and goes off on
//   the first free one, a light that lands can be cancelled into another light or a heavy, a tapped jump is a
//   short hop, guard in the air drops you (fast fall, or the dive's "down"), and feet grip the ground hard.
// - HP and launch %: hits take HP and build launch %, which makes the next knockback go further.
//   HP at zero or a fall off the ring ends it.
import { clamp } from "@rustybuns/util";
import { typeMul, type Field } from "./fields.ts";
import type { Delivery, Fx } from "./moves.ts";
import { body, type Body, type Creature, type Move, type Slot } from "./roster.ts";

export const HZ = 60;
const DT = 1 / HZ;
export const ARENA = { radius: 16, ceiling: 7, fallKo: -6, lake: { x: 7 } } as const;
const GRAVITY = 22;
export const ROUND_TICKS = 99 * HZ;

export interface V3 { x: number; y: number; z: number }
export interface Input {
  mx: number; mz: number;     // world-space move, length ≤ 1
  up: boolean; down: boolean; // jump / fly up, fly down
  light: boolean; heavy: boolean; special: boolean; ultimate: boolean;
  guard: boolean; dash: boolean; charge: boolean;
}
export const IDLE: Readonly<Input> = Object.freeze({ mx: 0, mz: 0, up: false, down: false, light: false, heavy: false, special: false, ultimate: false, guard: false, dash: false, charge: false });

export type State = "free" | "attack" | "stun" | "guard" | "charge" | "dash";
export interface Fighter {
  c: Creature; b: Body; moves: Record<Slot, Move>;
  pos: V3; vel: V3; yaw: number;
  hp: number; launch: number; stamina: number; energy: number;
  state: State; t: number;             // frames in this state
  /** `aim` is where a ranged move goes, locked on the target when it was pressed (yaw and pitch, radians). */
  act: { move: Move; hit: boolean; dive: boolean; tired?: boolean; aim?: { yaw: number; pitch: number } } | null;
  stun: number; clipped: number;       // frames left: hitstun, wings clipped
  flying: boolean; onGround: boolean; airJumps: number; rise: boolean; exhausted: boolean;
  prev: Input; invuln: number;
  /** The last press that hasn't acted yet, and frames it is kept for (BUFFER). */
  buf: { k: Press; left: number } | null;
  /** Off the ground on a jump that's still held: letting go now makes it a short hop. */
  hop: boolean;
  /** The gap held while circling the opponent (metres), set whenever you aren't circling. */
  ring: number;
  /** Turning speed now (rad/s, + is counter-clockwise): facing has momentum, so a reversal has to wind down first. */
  spin: number;
  /** Radians travelled round the opponent lately, signed by direction; it bleeds away when you square up (ORBIT). */
  orbit: number; bearing: number;
  /** Recoverable health: lost HP that comes back if you aren't hit again inside RED.window (then it's gone for good). */
  red: number;
  /** Ticks since a hit last landed on you. */
  hurt: number;
  /** Marks a field's hit left (fields.ts MARK): frames left, and damage a tick for a burn or poison. */
  marks: { dot: number; dotPer: number; dotField: Field | null; chill: number; root: number };
}
/** A ranged move's shape while it is live. `at` is where it comes from (the mouth, or the caster's feet for a nova)
 * except a blast's, which is where the lob lands; `from` is where the lob left. `dir` is the aim, `t` frames since it
 * went off, and `struck` who it has already hit (once each). */
export type Ranged = Exclude<Delivery, { shape: "touch" }>;
export interface Area { owner: 0 | 1; move: Move; d: Ranged; power: number; at: V3; from: V3; dir: V3; t: number; life: number; struck: [boolean, boolean] }
export type Event =
  | { kind: "hit"; by: 0 | 1; on: 0 | 1; move: string; slot: Slot; fx: Fx; field: Field; damage: number; guarded: boolean; rear: boolean; at: V3 }
  | { kind: "move"; by: 0 | 1; move: Move; at: V3; yaw: number; target: V3 } // a move goes off (its first live frame)
  | { kind: "land"; who: 0 | 1; speed: number } // feet back on the ring, at this fall speed
  | { kind: "clipped"; who: 0 | 1 }
  | { kind: "ledge"; who: 0 | 1 }
  | { kind: "ko"; who: 0 | 1; how: "hp" | "ring-out" | "time" };
export interface Match { tick: number; f: [Fighter, Fighter]; areas: Area[]; events: Event[]; winner: 0 | 1 | null; over: boolean }

/** Frame data comes from a move's power: big moves wind up longer and leave you open longer. */
export function frames(m: Move, tired = false) {
  const ult = m.slot === "ultimate" ? 12 : 0;
  // Commitment: heavies and launchers wind up in a readable beat and leave you open after; lights stay quick.
  const [wind, rest] = WEIGHT[m.slot];
  const recovery = Math.round(8 + m.power / 8) + ult + rest;
  const startup = Math.round((Math.round(4 + m.power / 10) + ult + wind) * HEAVY);
  return { startup, active: m.slot === "beam" || m.slot === "special" ? 1 : 5, recovery: Math.round((tired ? Math.round(recovery * 1.5) : recovery) * HEAVY) };
}
/** Weight of combat: every wind-up and recovery is this much longer, so a swing is a commitment with an opening after it (owner feel check, #2964: 30-50% slower). */
export const HEAVY = 1.4;
/** Extra wind-up and recovery frames per slot, on top of what power gives. */
const WEIGHT: Record<Slot, [number, number]> = { light: [0, 2], heavy: [8, 10], launcher: [5, 8], special: [0, 4], beam: [4, 6], ultimate: [4, 8] };
export const COST: Record<Slot, number> = { light: 0, heavy: 0, launcher: 0, special: 15, beam: 35, ultimate: 100 };
/** Stamina a swing spends (the same seconds-of-effort unit as a dash); running dry makes the swing's recovery 50% longer. */
export const SWING: Record<Slot, number> = { light: 0.12, heavy: 0.5, launcher: 0.4, special: 0.2, beam: 0.35, ultimate: 0.5 };
export const GUARD_COST = 0.1;

function fighter(c: Creature, side: 0 | 1): Fighter {
  const b = body(c);
  return {
    c, b, moves: Object.fromEntries(c.moves.map((m) => [m.slot, m])) as Record<Slot, Move>,
    pos: { x: side ? 6 : -6, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: side ? Math.PI : 0,
    hp: b.hp, launch: 0, stamina: b.stamina, energy: 20,
    state: "free", t: 0, act: null, stun: 0, clipped: 0,
    flying: false, onGround: true, airJumps: 1, rise: true, exhausted: false, prev: IDLE, invuln: 0, ring: 0, buf: null, hop: false,
    spin: 0, orbit: 0, bearing: side ? 0 : Math.PI, red: 0, hurt: 999,
    marks: { dot: 0, dotPer: 0, dotField: null, chill: 0, root: 0 },
  };
}
export const newMatch = (a: Creature, b: Creature): Match => ({ tick: 0, f: [fighter(a, 0), fighter(b, 1)], areas: [], events: [], winner: null, over: false });

const fwd = (yaw: number) => ({ x: Math.cos(yaw), z: Math.sin(yaw) });
const angleTo = (a: V3, b: V3) => Math.atan2(b.z - a.z, b.x - a.x);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const turn = (from: number, to: number, max: number) => from + clamp(wrap(to - from), -max, max);
const flat = (a: V3, b: V3) => Math.hypot(b.x - a.x, b.z - a.z);
export const inLake = (p: V3) => p.x > ARENA.lake.x && Math.hypot(p.x, p.z) < ARENA.radius;
const overRing = (p: V3) => Math.hypot(p.x, p.z) <= ARENA.radius;
const pressed = (f: Fighter, i: Input, k: keyof Input) => !!i[k] && !f.prev[k];
/** Guard held in the air is "down": a fast fall, a flyer's descent, and with a heavy the dive. */
const drops = (f: Fighter, i: Input) => i.down || (i.guard && !f.onGround);

/** The buttons that act on a press, highest first when two come on the same tick. */
type Press = "ultimate" | "special" | "heavy" | "light" | "dash" | "up";
const PRESSES: readonly Press[] = ["ultimate", "special", "heavy", "light", "dash", "up"];
/** Frames a press made while busy (mid-swing, in hitstun, dashing) is kept, to go off on the first free frame. */
export const BUFFER = 8;
/** How much harder feet grip on the ground when stopping or turning back than when speeding up. */
export const TRACTION = 3;
/** A tapped jump: let go while rising and the climb is cut to this share of the jump speed. */
export const SHORT_HOP = 0.55;
/** Falling with guard (or down) held, past the top of a jump: this fast, m/s. */
export const FAST_FALL = 11;

export const DIVE = { fall: 12, tuck: 4 } as const;
/** How far past the ring's edge (beyond your own radius) and how far below it you can still catch the ledge. */
export const LEDGE = { reach: 0.6, below: 1.5 } as const;
/**
 * Circling someone wears you out; turning to face them doesn't. `free` radians of orbit in one direction cost
 * nothing, past it your sideways pace falls (to `slow` of it by `free + span`) and stamina drains (`drain`/s at
 * full). It bleeds off at `bleed` per second only while you're squared up (going round slower than `still`
 * rad/s); going back the other way unwinds it too.
 */
export const ORBIT = { free: 1.2, span: 2, slow: 0.25, drain: 0.6, bleed: 0.6, still: 0.3 } as const;
/**
 * Recoverable damage: `share` of each clean hit is red, and comes back at `regen` HP a second once you've gone
 * `wait` ticks unhit. A hit landing within `window` ticks of the last one makes the red real first. Combos and
 * trades pay; a poke and a run away doesn't.
 */
export const RED = { share: 0.5, regen: 5, wait: 90, window: 90 } as const;
/** Energy: the charge button's rate (scaled down by mass), and what a clean hit gives the one landing it and the one taking it. */
export const ENERGY = { charge: 48, dealt: 6, taken: 5 } as const;
/** A heavy or launcher swing tracks its target through the wind-up (extra rad/s) and steps in on its live frames (m, plus the body's radius). */
export const LUNGE = { track: 3, step: 0.6 } as const;

function start(m: Match, side: 0 | 1, slot: Slot, i: Input) {
  const f = m.f[side];
  const move = f.moves[slot];
  if (f.energy < COST[slot]) return;
  f.energy -= COST[slot];
  const tired = f.exhausted || f.stamina < SWING[slot];
  f.stamina = Math.max(0, f.stamina - SWING[slot]);
  if (f.stamina <= 0) f.exhausted = true;
  const dive = slot === "heavy" && f.flying && drops(f, i);
  f.state = "attack"; f.t = 0; f.act = { move, hit: false, dive, tired };
  if (move.delivery.shape !== "touch") {
    // Lock-on: the shape goes where the target stands now; a sidestep in the wind-up takes you out of it.
    const o = m.f[side ? 0 : 1];
    f.act.aim = { yaw: angleTo(f.pos, o.pos), pitch: clamp(Math.atan2(o.pos.y + o.b.height / 2 - (f.pos.y + f.b.height / 2), Math.max(1, flat(f.pos, o.pos))), -0.9, 0.9) };
  }
  f.flying = f.flying && slot !== "launcher" && !dive;
  if (dive) {
    // Straight at the target and down, live after a short tuck instead of the heavy's full wind-up.
    const o = m.f[side ? 0 : 1], a = angleTo(f.pos, o.pos), sp = Math.min(f.b.topSpeed * 1.6, flat(f.pos, o.pos) * 3.5);
    f.vel.x = Math.cos(a) * sp; f.vel.z = Math.sin(a) * sp; f.vel.y = -DIVE.fall;
    f.t = Math.max(0, frames(move).startup - DIVE.tuck);
  }
  // The launcher in the air is a rising strike, once per trip off the ground: everyone's way back to the ledge.
  if (slot === "launcher" && !f.onGround && f.rise) {
    f.rise = false; f.vel.y = Math.max(f.vel.y, f.b.jump);
    f.vel.x = i.mx * f.b.topSpeed * 0.8; f.vel.z = i.mz * f.b.topSpeed * 0.8;
  }
}

function control(m: Match, side: 0 | 1, i: Input) {
  const f = m.f[side], o = m.f[side ? 0 : 1], b = f.b;
  const move = Math.hypot(i.mx, i.mz) > 0.1;
  const toward = move && (i.mx * Math.cos(angleTo(f.pos, o.pos)) + i.mz * Math.sin(angleTo(f.pos, o.pos))) / Math.hypot(i.mx, i.mz) > 0.5;
  if (f.state === "guard" && !i.guard) f.state = "free";
  if (f.state === "charge" && !i.charge) f.state = "free";
  const fresh = PRESSES.find((k) => pressed(f, i, k));
  if (fresh) f.buf = { k: fresh, left: BUFFER };
  // A light that landed is cancelled into the next light or heavy once its hit is out: a jab string.
  const fr = f.act && frames(f.act.move, f.act.tired);
  const chain = f.state === "attack" && f.act?.hit && f.act.move.slot === "light" && fr && f.t >= fr.startup + fr.active && (f.buf?.k === "light" || f.buf?.k === "heavy");
  if (f.state !== "free" && f.state !== "guard" && f.state !== "charge" && !chain) return;
  const use = (k: Press) => f.buf?.k === k && (f.buf = null, true);

  if (use("ultimate")) return start(m, side, "ultimate", i);
  if (use("special")) return start(m, side, toward ? "beam" : "special", i);
  // Jump held, or fallen below the ring's lip: the heavy is the launcher, the rising strike back to the ledge.
  if (use("heavy")) return start(m, side, i.up || (!f.onGround && !f.flying && f.pos.y < 0 && f.rise) ? "launcher" : "heavy", i);
  if (use("light")) return start(m, side, "light", i);
  if (f.buf?.k === "dash" && !f.exhausted && f.stamina >= b.dashCost && f.marks.root === 0) {
    f.buf = null;
    const d = move ? { x: i.mx, z: i.mz } : (() => { const k = fwd(f.yaw); return { x: -k.x, z: -k.z }; })();
    const n = Math.hypot(d.x, d.z) || 1;
    f.vel.x = (d.x / n) * b.topSpeed * 2.4; f.vel.z = (d.z / n) * b.topSpeed * 2.4;
    f.stamina -= b.dashCost; f.state = "dash"; f.t = 0;
    f.invuln = b.dodge; // the quick creatures' dodge is the vanish
    return;
  }
  if (i.guard && f.onGround && !f.exhausted) { if (f.state !== "guard") f.stamina = Math.max(0, f.stamina - GUARD_COST); f.state = "guard"; return; }
  if (i.charge && f.onGround) { f.state = "charge"; return; }

  // Jump, air jump, or take off. Flying needs stamina and wings that aren't clipped.
  if (f.buf?.k === "up" && f.marks.root === 0) {
    f.buf = null;
    if (f.onGround) { f.vel.y = b.jump; f.onGround = false; f.hop = true; }
    else if (b.air === "flight" && !f.flying && !f.exhausted && f.clipped === 0) { f.flying = true; f.vel.y = Math.max(f.vel.y, 0); }
    else if (f.airJumps > 0) { f.vel.y = b.jump * 0.85; f.airJumps--; }
  }
}

function moveBody(m: Match, side: 0 | 1, i: Input) {
  const f = m.f[side], o = m.f[side ? 0 : 1], b = f.b;
  const canSteer = f.state === "free" || f.state === "attack";
  const slow = (f.exhausted ? 0.6 : 1) * (f.marks.chill ? 0.65 : 1) * (inLake(f.pos) && f.onGround ? (f.c.fields.includes("tide") ? 1.15 : 0.6) : 1);
  const wish = canSteer ? { x: i.mx * b.topSpeed * slow, z: i.mz * b.topSpeed * slow } : { x: 0, z: 0 };
  // Swinging slows you, except the rising strike in the air, which is how you steer back to the ledge.
  const rising = f.state === "attack" && f.act?.move.slot === "launcher" && !f.onGround;
  if (f.state === "attack" && !rising) { wish.x *= 0.3; wish.z *= 0.3; }
  // Orbit: on the ground, sideways input circles the opponent instead of running off along a tangent: the gap
  // you had when you started circling is pulled back to, so the path is a ring. Forward or back resets the gap.
  const lock = f.onGround && !f.flying && f.state === "free";
  if (lock) {
    const a = angleTo(f.pos, o.pos), ux = Math.cos(a), uz = Math.sin(a), d = flat(f.pos, o.pos);
    const along = wish.x * ux + wish.z * uz;
    // Sideways round them is slow, slower for big bodies, and slower again the longer you keep circling.
    const tired = clamp((Math.abs(f.orbit) - ORBIT.free) / ORBIT.span, 0, 1);
    const side = (wish.x * -uz + wish.z * ux) * b.lateral * (1 - (1 - ORBIT.slow) * tired);
    if (Math.abs(side) > Math.abs(along) * 2 * b.lateral && f.ring > 0) {
      const radial = along + (d - f.ring) * 4; // + closes in
      wish.x = -uz * side + ux * radial; wish.z = ux * side + uz * radial;
    } else { f.ring = d; wish.x = ux * along - uz * side; wish.z = uz * along + ux * side; }
  }
  // Feet bite when you stop or turn back (no slide past where you let go); speeding up keeps the body's own pace.
  const braking = wish.x * f.vel.x + wish.z * f.vel.z < 0.25 * Math.hypot(f.vel.x, f.vel.z) * Math.hypot(wish.x, wish.z) || Math.hypot(wish.x, wish.z) < 0.1;
  const grip = f.state === "stun" || f.state === "dash" ? 2 : f.onGround ? b.accel * (braking ? TRACTION : 1) : b.accel * (f.flying ? 0.8 : 0.35);
  const k = Math.min(1, grip * DT / Math.max(1, b.topSpeed));
  f.vel.x += (wish.x - f.vel.x) * k * (f.state === "stun" ? 0.15 : 1);
  f.vel.z += (wish.z - f.vel.z) * k * (f.state === "stun" ? 0.15 : 1);
  // Knockback bleeds off, faster on the ground, so a launch is a distance rather than a trip to the horizon.
  if (f.state === "stun" || !f.onGround) { const drag = Math.exp(-(f.onGround ? 6 : f.state === "stun" ? 2.2 : 1.2) * DT); f.vel.x *= drag; f.vel.z *= drag; }

  // Facing: toward the opponent while you're on the ground (not tumbling or dashing), attack, guard, charge or
  // fly (flyers strafe); in the air off a jump you face where you go. Big bodies swing wide.
  const want = lock || f.flying || f.state === "attack" || f.state === "guard" || f.state === "charge" || Math.hypot(wish.x, wish.z) < 0.5
    ? angleTo(f.pos, o.pos) : Math.atan2(wish.z, wish.x);
  if (f.act?.aim) { f.yaw = f.act.aim.yaw; f.spin = 0; } // a ranged move holds its aim through the wind-up
  else if (f.state !== "stun") {
    // Turning has momentum: spin builds toward what's needed and winds down to stop, so a big body carries its
    // turn past where it meant to stop, and a reversal has to wind down first. A heavy swing's wind-up tracks.
    const swing = f.state === "attack" && f.act && f.act.move.delivery.shape === "touch" && (f.act.move.slot === "heavy" || f.act.move.slot === "launcher") && f.t < frames(f.act.move, f.act.tired).startup;
    const top = (b.turnRate + (swing ? LUNGE.track : 0)) * (f.marks.chill ? 0.65 : 1), err = wrap(want - f.yaw);
    const goal = clamp(err * 8, -top, top), spinUp = b.spinUp * (swing ? 2 : 1);
    f.spin += clamp(goal - f.spin, -spinUp * DT, spinUp * DT);
    f.yaw = wrap(f.yaw + f.spin * DT);
  } else f.spin *= 0.8;

  if (f.hop && (f.vel.y <= 0 || f.flying)) f.hop = false;
  if (f.hop && !i.up) { f.vel.y = Math.min(f.vel.y, b.jump * SHORT_HOP); f.hop = false; }
  if (f.flying) {
    const lift = (i.up ? 4 : 0) - (drops(f, i) ? 5 : 0);
    f.vel.y += (lift - f.vel.y) * Math.min(1, 6 * DT);
    if (f.pos.y >= ARENA.ceiling && f.vel.y > 0) f.vel.y = 0;
  } else {
    f.vel.y -= GRAVITY * DT;
    if (!f.onGround && f.vel.y <= 0 && f.state !== "stun" && drops(f, i)) f.vel.y = Math.min(f.vel.y, -FAST_FALL);
  }

  f.pos.x += f.vel.x * DT; f.pos.y += f.vel.y * DT; f.pos.z += f.vel.z * DT;
  const wasGround = f.onGround;
  if (f.pos.y <= 0 && overRing(f.pos) && f.pos.y > -1) {
    f.pos.y = 0;
    if (f.vel.y < 0) { if (!wasGround) m.events.push({ kind: "land", who: side, speed: -f.vel.y }); f.vel.y = 0; }
    f.onGround = true; f.flying = false; f.airJumps = 1; f.rise = true;
  } else f.onGround = false;
  // The ledge: reach the ring's lip from just below or beside it, not tumbling from a hit, and you climb on.
  const r = Math.hypot(f.pos.x, f.pos.z);
  if (!f.onGround && f.state !== "stun" && r > ARENA.radius && r < ARENA.radius + f.b.radius + LEDGE.reach && f.pos.y < 0.3 && f.pos.y > -LEDGE.below) {
    const k = (ARENA.radius - 0.4) / r;
    f.pos.x *= k; f.pos.z *= k; f.pos.y = 0; f.vel = { x: 0, y: 0, z: 0 };
    f.onGround = true; f.flying = false; f.airJumps = 1; f.rise = true;
    if (f.state === "attack") { f.state = "free"; f.act = null; f.t = 0; }
    m.events.push({ kind: "ledge", who: side });
  }
  if (!wasGround && f.onGround && f.state === "stun") f.stun = Math.min(f.stun, 12);

  // The orbit meter: how far round them you've gone lately (on the ground), bleeding away; past ORBIT.free it stops your
  // stamina coming back and drains it instead.
  const bearing = angleTo(o.pos, f.pos), went = wrap(bearing - f.bearing);
  f.bearing = bearing;
  if (f.onGround && !f.flying && f.state !== "stun") f.orbit += went;
  if (Math.abs(went) < ORBIT.still * DT) f.orbit -= clamp(f.orbit, -ORBIT.bleed * DT, ORBIT.bleed * DT);
  const tired = clamp((Math.abs(f.orbit) - ORBIT.free) / ORBIT.span, 0, 1);
  // Stamina: flying and sprinting spend it, standing on the ground earns it back (not while circling).
  const speed = Math.hypot(f.vel.x, f.vel.z);
  if (f.flying) f.stamina -= DT * (1 + (i.up ? 0.4 : 0));
  else if (f.state === "guard") f.stamina -= DT * 0.4;
  else if (f.onGround && speed > b.topSpeed * 0.7) f.stamina -= DT * 0.2;
  else if (f.onGround && f.state !== "attack") f.stamina += DT * (f.state === "charge" ? 0.6 : 1) * (1 - tired);
  if (tired > 0) f.stamina -= DT * ORBIT.drain * tired;
  f.stamina = clamp(f.stamina, 0, b.stamina);
  if (f.stamina <= 0) { f.exhausted = true; f.flying = false; if (f.state === "guard") { f.state = "stun"; f.stun = 50; } }
  if (f.exhausted && f.stamina >= b.stamina * 0.35) f.exhausted = false;
  // Red health comes back once you've been clear of hits for a beat.
  f.hurt++;
  if (f.red > 0 && f.hurt > RED.wait) { const back = Math.min(f.red, RED.regen * DT); f.red -= back; f.hp = Math.min(b.hp, f.hp + back); }
  if (f.state === "charge") f.energy = Math.min(100, f.energy + DT * ENERGY.charge / Math.log10(b.mass + 10));
}

function attackFrames(m: Match, side: 0 | 1) {
  const f = m.f[side], o = m.f[side ? 0 : 1];
  if (f.state !== "attack" || !f.act) return;
  const { move, dive } = f.act, fr = frames(move, f.act.tired);
  f.t++;
  if (dive && !f.onGround && f.t === fr.startup + 1) f.t = fr.startup; // live all the way down
  else if (f.t === fr.startup && move.delivery.shape === "touch") m.events.push({ kind: "move", by: side, move, at: { ...f.pos }, yaw: f.yaw, target: { ...o.pos } });
  if (f.t === fr.startup && move.delivery.shape !== "touch") {
    const area = loose(f, side, move, move.delivery, o.pos);
    m.areas.push(area);
    m.events.push({ kind: "move", by: side, move, at: { ...f.pos }, yaw: f.yaw, target: area.d.shape === "blast" ? { ...area.at } : { ...o.pos } });
  }
  const melee = move.delivery.shape === "touch";
  // A heavy or launcher steps into its live frames, the big bodies further: a slow turner closes the gap it can't circle.
  if (melee && !f.act.hit && f.onGround && (move.slot === "heavy" || move.slot === "launcher") && f.t >= fr.startup && f.t < fr.startup + fr.active) {
    const k = fwd(f.yaw), room = flat(f.pos, o.pos) - f.b.radius - o.b.radius - 0.2;
    const stepBy = Math.min(Math.max(0, room), (LUNGE.step + f.b.radius) / fr.active);
    f.pos.x += k.x * stepBy; f.pos.z += k.z * stepBy;
  }
  if (melee && !f.act.hit && f.t >= fr.startup && f.t < fr.startup + fr.active && o.invuln === 0) {
    const reach = f.b.radius + o.b.radius + (move.slot === "light" ? 0.7 : 1.1);
    const k = fwd(f.yaw), dx = o.pos.x - f.pos.x, dz = o.pos.z - f.pos.z, d = Math.hypot(dx, dz);
    const ahead = d < 0.01 || (dx * k.x + dz * k.z) / d > 0.35;         // in front of you, not behind
    const dy = o.pos.y - f.pos.y;
    const vReach = move.slot === "launcher" ? 4.5 : f.b.height + 0.5;  // the launcher is everyone's anti-air
    const below = dive ? -(o.b.height + 1) : -1.5;                    // a dive hits what it lands on
    if (d <= reach && ahead && dy > below && dy < vReach) {
      f.act.hit = true; hit(m, side, side ? 0 : 1, move, move.power, f.pos, o.pos);
      // A dive that lands bounces off the target and recovers in the air; one that misses recovers on the ground.
      if (dive) { f.vel.y = f.b.jump; f.vel.x *= -0.4; f.vel.z *= -0.4; f.onGround = false; f.act.dive = false; }
    }
  }
  if (f.t >= fr.startup + fr.active + fr.recovery) { f.state = "free"; f.act = null; f.t = 0; }
}

/** `by` lands `move` on `on` (the same side when your own blast catches you); it came from `from`, and struck at `at`. */
function hit(m: Match, by: 0 | 1, on: 0 | 1, move: Move, power: number, from: V3, at: V3) {
  const a = m.f[by], d = m.f[on], self = by === on;
  const ranged = move.delivery.shape !== "touch";
  const atk = ranged ? a.c.stats.focus : a.c.stats.might, def = ranged ? d.c.stats.will : d.c.stats.guard;
  // A guard faces what comes at it; a blast comes from above, so no guard stops it.
  const facingAway = Math.abs(wrap(angleTo(d.pos, from) - d.yaw)), guarded = d.state === "guard" && facingAway < 1.2 && move.delivery.shape !== "blast";
  // From behind, in the blind spot a slow turner can't cover: harder, longer stun, no armour.
  const rear = !ranged && facingAway > 2.2;
  // Power is squashed (a 120 move is ~2.6x a 30, not 4x) so quick light hits add up.
  let damage = 1.1 * Math.pow(power, 0.7) * Math.sqrt(atk / def) * typeMul(move.field, d.c.fields);
  damage *= a.c.edge;
  if (guarded) damage *= move.field === "iron" ? 0.4 : 0.2;
  if (rear) damage *= 1.35;
  // Hit again while red: it turns real. Then part of this hit is red, to come back if you get clear.
  if (!guarded) { if (d.hurt < RED.window) d.red = 0; d.red += damage * RED.share; d.hurt = 0; }
  d.hp -= damage;
  d.red = Math.min(d.red, Math.max(0, d.b.hp - d.hp));
  d.launch += guarded ? 0 : damage * 0.8 * (move.field === "stone" ? 1.3 : 1);
  if (!self) { a.energy = Math.min(100, a.energy + ENERGY.dealt + (move.field === "wild" ? 5 : 0)); d.energy = Math.min(100, d.energy + ENERGY.taken); }
  if (move.drain && !self) a.hp = Math.min(a.b.hp, a.hp + damage * move.drain / 100);
  m.events.push({ kind: "hit", by, on, move: move.name, slot: move.slot, fx: move.fx, field: move.field, damage, guarded, rear, at: { ...at } });
  if (guarded) { d.stamina -= power / 100; return; }
  mark(d, move.field, damage);

  // Super armour: a heavy body winding up a big move takes a light hit without flinching (dread gets through).
  if (!rear && move.field !== "shadow" && d.state === "attack" && d.act && d.act.move.power >= 60 && power < 70 && d.b.armour > 0.3) return;
  const up = Math.min(0.95, (move.slot === "launcher" ? 0.9 : move.slot === "heavy" || move.slot === "ultimate" ? 0.45 : 0.25) + (move.field === "gale" ? 0.15 : 0));
  const kb = (2.5 + power * 0.05) * (1 + d.launch / 80) * Math.pow(70 / (d.b.mass + 10), 0.4) * (1 - d.b.armour * 0.4) * (move.field === "tide" ? 1.2 : 1);
  const ang = flat(from, d.pos) > 0.05 ? angleTo(from, d.pos) : a.yaw, h = Math.sqrt(1 - up * up);
  d.vel.x = Math.cos(ang) * kb * h; d.vel.z = Math.sin(ang) * kb * h; d.vel.y = kb * up;
  if (d.vel.y > 0) d.onGround = false;
  d.state = "stun"; d.stun = Math.round(10 + power / 6 + d.launch / 12 + (rear ? 4 : 0) + (move.field === "storm" ? 6 : 0)); d.act = null; d.t = 0;
  if (d.flying && power >= 70) { d.flying = false; d.clipped = 3 * HZ; m.events.push({ kind: "clipped", who: on }); }
  else d.flying = false;
}

/** The marks that last (fields.ts MARK); the one-hit ones are applied where the hit is worked out. */
function mark(d: Fighter, field: Field, damage: number) {
  const k = d.marks;
  if (field === "ember" || field === "venom") {
    const [frames, share] = field === "ember" ? [3 * HZ, 0.1] : [5 * HZ, 0.2];
    k.dot = frames; k.dotPer = (damage * share) / frames; k.dotField = field;
  }
  if (field === "frost") k.chill = 2 * HZ;
  if (field === "grove") k.root = HZ;
  if (field === "spirit") d.energy = Math.max(0, d.energy - 8);
}

/** Wall height: jump it. */
export const WALL_HEIGHT = 1.8;
/** Frames a cone pours for; a nova takes this long to spread to its radius. */
const CONE_FRAMES = 10, NOVA_FRAMES = 8;

/** A ranged move going off: its shape, from the mouth along the locked aim (a blast lands on the target's spot, out to its range). */
function loose(f: Fighter, side: 0 | 1, move: Move, d: Ranged, target: V3): Area {
  const aim = f.act?.aim ?? { yaw: f.yaw, pitch: 0 }, k = fwd(aim.yaw);
  const flatAim = d.shape === "wall" || d.shape === "cone" ? 0 : aim.pitch;
  const dir = { x: k.x * Math.cos(flatAim), y: Math.sin(flatAim), z: k.z * Math.cos(flatAim) };
  const mouth = { x: f.pos.x + k.x * f.b.radius, y: f.pos.y + (d.shape === "wall" ? 0 : f.b.height * 0.6), z: f.pos.z + k.z * f.b.radius };
  const power = move.power * (move.slot === "ultimate" ? 1.4 : 1);
  const base = { owner: side, move, d, power, from: mouth, dir, t: 0, struck: [false, false] as [boolean, boolean] };
  switch (d.shape) {
    case "column": return { ...base, at: mouth, life: Math.ceil((d.length / d.speed) * HZ) + 4 };
    case "wall": return { ...base, at: mouth, life: Math.ceil((d.travel / d.speed) * HZ) };
    case "cone": return { ...base, at: mouth, life: CONE_FRAMES };
    case "nova": return { ...base, at: { ...f.pos }, from: { ...f.pos }, life: NOVA_FRAMES };
    case "blast": {
      const r = Math.min(d.range, flat(f.pos, target)), a = angleTo(f.pos, target);
      return { ...base, at: { x: f.pos.x + Math.cos(a) * r, y: 0, z: f.pos.z + Math.sin(a) * r }, life: Math.max(1, Math.round(d.flight * HZ)) + 1 };
    }
  }
}

/** Where a live shape's front is now (a column's tip, a wall's middle, the lob in its arc): the page draws it here. */
export function head(a: Area): V3 {
  const s = a.t / HZ, along = (n: number) => ({ x: a.at.x + a.dir.x * n, y: a.at.y + a.dir.y * n, z: a.at.z + a.dir.z * n });
  switch (a.d.shape) {
    case "column": return along(Math.min(a.d.length, a.d.speed * s));
    case "wall": return along(Math.min(a.d.travel, a.d.speed * s) + a.d.depth / 2);
    case "cone": return along(a.d.length / 2);
    case "nova": return { ...a.at };
    case "blast": {
      const k = Math.min(1, a.t / (a.life - 1)), top = 2 + flat(a.from, a.at) * 0.35;
      return { x: a.from.x + (a.at.x - a.from.x) * k, y: a.from.y + (a.at.y - a.from.y) * k + 4 * top * k * (1 - k), z: a.from.z + (a.at.z - a.from.z) * k };
    }
  }
}

/** Is fighter `t` inside live shape `a` this frame? Its body counts: a capsule `b.radius` wide and `b.height` tall. */
export function covers(a: Area, t: Fighter): boolean {
  const r = t.b.radius, dx = t.pos.x - a.at.x, dz = t.pos.z - a.at.z;
  const h = Math.hypot(a.dir.x, a.dir.z) || 1, ux = a.dir.x / h, uz = a.dir.z / h;
  const along = dx * ux + dz * uz, side = Math.abs(-dx * uz + dz * ux);
  const s = a.t / HZ;
  switch (a.d.shape) {
    case "column": {
      // A rectangle along the aim out to the tip, pitched: at the target's distance the column's height must cross its body.
      const tip = Math.min(a.d.length, a.d.speed * s) * h, half = a.d.width / 2;
      if (along < -r || along > tip + r || side > half + r) return false;
      const y = a.at.y + (along / h) * a.dir.y;
      return y > t.pos.y - half && y < t.pos.y + t.b.height + half;
    }
    case "wall": {
      const near = Math.min(a.d.travel, a.d.speed * s);
      return along > near - r && along < near + a.d.depth + r && side < a.d.width / 2 + r && t.pos.y < a.at.y + WALL_HEIGHT;
    }
    case "cone": {
      const dist = Math.hypot(dx, dz), half = (a.d.angle * Math.PI) / 360;
      if (dist > a.d.length + r || along <= 0) return false;
      const off = Math.atan2(side, along) - Math.atan2(r, Math.max(dist, 0.01));
      return off < half && Math.abs(t.pos.y + t.b.height / 2 - a.at.y) < Math.max(1.5, dist * Math.tan(half));
    }
    case "nova": {
      const grown = a.d.radius * Math.min(1, (a.t + 1) / NOVA_FRAMES);
      return Math.hypot(dx, dz) < grown + r && Math.abs(t.pos.y - a.at.y) < a.d.radius;
    }
    case "blast":
      // Only on the frame it lands: off the ring, or flying high over it, and it misses.
      return a.t === a.life - 1 && Math.hypot(dx, dz) < a.d.radius + r && t.pos.y < a.at.y + a.d.radius;
  }
}

function areas(m: Match) {
  for (const a of m.areas) {
    // Your own blast catches you too; your columns, walls, cones and novas never do.
    for (const on of [0, 1] as const) {
      const t = m.f[on];
      if (a.struck[on] || t.invuln > 0 || (on === a.owner && a.d.shape !== "blast")) continue;
      if (covers(a, t)) { a.struck[on] = true; hit(m, a.owner, on, a.move, a.power, a.d.shape === "column" || a.d.shape === "cone" || a.d.shape === "wall" ? m.f[a.owner].pos : a.at, { ...t.pos, y: t.pos.y + t.b.height / 2 }); }
    }
    a.t++;
  }
  m.areas = m.areas.filter((a) => a.t < a.life);
}

/** One tick. Events from this tick only are in `m.events`. */
export function step(m: Match, inputs: [Input, Input]) {
  m.events = [];
  if (m.over) return;
  m.tick++;
  for (const side of [0, 1] as const) {
    const f = m.f[side];
    if (f.state === "stun" && --f.stun <= 0) f.state = "free";
    if (f.state === "dash" && ++f.t >= 12) { f.state = "free"; f.t = 0; }
    if (f.invuln > 0) f.invuln--;
    if (f.buf && --f.buf.left <= 0) f.buf = null;
    const k = f.marks;
    if (k.dot > 0) { k.dot--; f.hp -= k.dotPer; }
    if (k.chill > 0) k.chill--;
    if (k.root > 0) k.root--;
    if (f.clipped > 0) f.clipped--;
    control(m, side, inputs[side]);
  }
  for (const side of [0, 1] as const) attackFrames(m, side);
  for (const side of [0, 1] as const) moveBody(m, side, inputs[side]);
  areas(m);
  // Bodies don't overlap: the lighter one gets pushed more.
  const [a, b] = m.f, d = flat(a.pos, b.pos), min = a.b.radius + b.b.radius;
  if (d < min && d > 1e-6 && Math.abs(a.pos.y - b.pos.y) < Math.max(a.b.height, b.b.height)) {
    const push = min - d, wa = b.b.mass / (a.b.mass + b.b.mass), nx = (b.pos.x - a.pos.x) / d, nz = (b.pos.z - a.pos.z) / d;
    a.pos.x -= nx * push * wa; a.pos.z -= nz * push * wa; b.pos.x += nx * push * (1 - wa); b.pos.z += nz * push * (1 - wa);
  }
  for (const side of [0, 1] as const) m.f[side].prev = inputs[side];
  for (const side of [0, 1] as const) {
    const f = m.f[side];
    const how = f.hp <= 0 ? "hp" : f.pos.y < ARENA.fallKo ? "ring-out" : null;
    if (how) return end(m, side ? 0 : 1, { kind: "ko", who: side, how });
  }
  if (m.tick >= ROUND_TICKS) {
    const [p, q] = m.f.map((f) => f.hp / f.b.hp) as [number, number];
    end(m, p >= q ? 0 : 1, { kind: "ko", who: p >= q ? 1 : 0, how: "time" });
  }
}
function end(m: Match, winner: 0 | 1, e: Event) { m.over = true; m.winner = winner; m.events.push(e); }

