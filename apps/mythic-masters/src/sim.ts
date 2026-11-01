// The fight, as a deterministic fixed-step sim (60 Hz). No DOM, no three.js: the page and the
// bot-vs-bot tuner (scripts/tune.ts) both drive `step` with one Input per fighter per tick.
//
// Rules worth knowing before tuning:
// - Mass is felt: knockback divides by it, armour on heavy bodies shrugs off light hits mid-swing.
// - Nothing hides in the air: flight drains stamina (out of it, you fall), the ceiling is low, every
//   creature's launcher reaches up, projectiles home in 3D, and a heavy hit on a flyer clips its wings.
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
import type { Fx } from "./moves.ts";
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
  act: { move: Move; hit: boolean; dive: boolean; tired?: boolean } | null;
  stun: number; clipped: number;       // frames left: hitstun, wings clipped
  flying: boolean; onGround: boolean; airJumps: number; rise: boolean; exhausted: boolean;
  prev: Input; invuln: number;
  /** The last press that hasn't acted yet, and frames it is kept for (BUFFER). */
  buf: { k: Press; left: number } | null;
  /** Off the ground on a jump that's still held: letting go now makes it a short hop. */
  hop: boolean;
  /** The gap held while circling the opponent (metres), set whenever you aren't circling. */
  ring: number;
  /** Marks a field's hit left (fields.ts MARK): frames left, and damage a tick for a burn or poison. */
  marks: { dot: number; dotPer: number; dotField: Field | null; chill: number; root: number };
}
export interface Shot { owner: 0 | 1; move: Move; pos: V3; vel: V3; radius: number; life: number; power: number; homing: number }
export type Event =
  | { kind: "hit"; by: 0 | 1; move: string; slot: Slot; fx: Fx; field: Field; damage: number; guarded: boolean; rear: boolean; at: V3 }
  | { kind: "move"; by: 0 | 1; move: Move; at: V3; yaw: number; target: V3 } // a move goes off (its first live frame)
  | { kind: "land"; who: 0 | 1; speed: number } // feet back on the ring, at this fall speed
  | { kind: "clash"; at: V3 }
  | { kind: "clipped"; who: 0 | 1 }
  | { kind: "ledge"; who: 0 | 1 }
  | { kind: "ko"; who: 0 | 1; how: "hp" | "ring-out" | "time" };
export interface Match { tick: number; f: [Fighter, Fighter]; shots: Shot[]; events: Event[]; winner: 0 | 1 | null; over: boolean }

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
    marks: { dot: 0, dotPer: 0, dotField: null, chill: 0, root: 0 },
  };
}
export const newMatch = (a: Creature, b: Creature): Match => ({ tick: 0, f: [fighter(a, 0), fighter(b, 1)], shots: [], events: [], winner: null, over: false });

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
export const TRACTION = 2.5;
/** A tapped jump: let go while rising and the climb is cut to this share of the jump speed. */
export const SHORT_HOP = 0.55;
/** Falling with guard (or down) held, past the top of a jump: this fast, m/s. */
export const FAST_FALL = 11;

export const DIVE = { fall: 12, tuck: 4 } as const;
/** How far past the ring's edge (beyond your own radius) and how far below it you can still catch the ledge. */
export const LEDGE = { reach: 0.6, below: 1.5 } as const;

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
    const along = wish.x * ux + wish.z * uz, side = wish.x * -uz + wish.z * ux;
    if (Math.abs(side) > Math.abs(along) * 2 && f.ring > 0) {
      const radial = along + (d - f.ring) * 4; // + closes in
      wish.x = -uz * side + ux * radial; wish.z = ux * side + uz * radial;
    } else f.ring = d;
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
  if (f.state !== "stun") f.yaw = turn(f.yaw, want, b.turnRate * DT * (f.marks.chill ? 0.65 : 1));

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

  // Stamina: flying and sprinting spend it, standing on the ground earns it back.
  const speed = Math.hypot(f.vel.x, f.vel.z);
  if (f.flying) f.stamina -= DT * (1 + (i.up ? 0.4 : 0));
  else if (f.state === "guard") f.stamina -= DT * 0.4;
  else if (f.onGround && speed > b.topSpeed * 0.7) f.stamina -= DT * 0.2;
  else if (f.onGround && f.state !== "attack") f.stamina += DT * (f.state === "charge" ? 0.6 : 1);
  f.stamina = clamp(f.stamina, 0, b.stamina);
  if (f.stamina <= 0) { f.exhausted = true; f.flying = false; if (f.state === "guard") { f.state = "stun"; f.stun = 50; } }
  if (f.exhausted && f.stamina >= b.stamina * 0.35) f.exhausted = false;
  if (f.state === "charge") f.energy = Math.min(100, f.energy + DT * 30 / Math.log10(b.mass + 10));
}

function attackFrames(m: Match, side: 0 | 1) {
  const f = m.f[side], o = m.f[side ? 0 : 1];
  if (f.state !== "attack" || !f.act) return;
  const { move, dive } = f.act, fr = frames(move, f.act.tired);
  f.t++;
  if (dive && !f.onGround && f.t === fr.startup + 1) f.t = fr.startup; // live all the way down
  else if (f.t === fr.startup) m.events.push({ kind: "move", by: side, move, at: { ...f.pos }, yaw: f.yaw, target: { ...o.pos } });
  if (f.t === fr.startup && (move.slot === "special" || move.slot === "beam" || (move.slot === "ultimate" && move.ranged))) {
    const k = fwd(f.yaw), beam = move.slot !== "special", sp = beam ? 30 : 14;
    const aim = clamp(Math.atan2(o.pos.y + o.b.height / 2 - (f.pos.y + f.b.height / 2), Math.max(1, flat(f.pos, o.pos))), -0.9, 0.9);
    m.shots.push({
      owner: side, move, power: move.power * (move.slot === "ultimate" ? 1.4 : 1),
      pos: { x: f.pos.x + k.x * (f.b.radius + 0.4), y: f.pos.y + f.b.height * 0.6, z: f.pos.z + k.z * (f.b.radius + 0.4) },
      vel: { x: k.x * sp * Math.cos(aim), y: Math.sin(aim) * sp, z: k.z * sp * Math.cos(aim) },
      radius: move.slot === "ultimate" ? 1 : beam ? 0.6 : 0.4, life: beam ? HZ : HZ * 1.6, homing: (move.accuracy / 100) * (beam ? 0.6 : 2.2),
    });
  }
  const melee = move.slot === "light" || move.slot === "heavy" || move.slot === "launcher" || (move.slot === "ultimate" && !move.ranged);
  if (melee && !f.act.hit && f.t >= fr.startup && f.t < fr.startup + fr.active && o.invuln === 0) {
    const reach = f.b.radius + o.b.radius + (move.slot === "light" ? 0.7 : 1.1);
    const k = fwd(f.yaw), dx = o.pos.x - f.pos.x, dz = o.pos.z - f.pos.z, d = Math.hypot(dx, dz);
    const ahead = d < 0.01 || (dx * k.x + dz * k.z) / d > 0.35;         // in front of you, not behind
    const dy = o.pos.y - f.pos.y;
    const vReach = move.slot === "launcher" ? 4.5 : f.b.height + 0.5;  // the launcher is everyone's anti-air
    const below = dive ? -(o.b.height + 1) : -1.5;                    // a dive hits what it lands on
    if (d <= reach && ahead && dy > below && dy < vReach) {
      f.act.hit = true; hit(m, side, move, move.power, o.pos);
      // A dive that lands bounces off the target and recovers in the air; one that misses recovers on the ground.
      if (dive) { f.vel.y = f.b.jump; f.vel.x *= -0.4; f.vel.z *= -0.4; f.onGround = false; f.act.dive = false; }
    }
  }
  if (f.t >= fr.startup + fr.active + fr.recovery) { f.state = "free"; f.act = null; f.t = 0; }
}

function hit(m: Match, by: 0 | 1, move: Move, power: number, at: V3) {
  const a = m.f[by], d = m.f[by ? 0 : 1];
  const ranged = move.slot === "special" || move.slot === "beam" || (move.slot === "ultimate" && move.ranged);
  const atk = ranged ? a.c.stats.focus : a.c.stats.might, def = ranged ? d.c.stats.will : d.c.stats.guard;
  const facingAway = Math.abs(wrap(angleTo(d.pos, a.pos) - d.yaw)), guarded = d.state === "guard" && facingAway < 1.2;
  // From behind, in the blind spot a slow turner can't cover: harder, longer stun, no armour.
  const rear = !ranged && facingAway > 2.2;
  // Power is squashed (a 120 move is ~2.6x a 30, not 4x) so quick light hits add up.
  let damage = 1.1 * Math.pow(power, 0.7) * Math.sqrt(atk / def) * typeMul(move.field, d.c.fields);
  damage *= a.c.edge;
  if (guarded) damage *= move.field === "iron" ? 0.4 : 0.2;
  if (rear) damage *= 1.35;
  d.hp -= damage;
  d.launch += guarded ? 0 : damage * 0.8 * (move.field === "stone" ? 1.3 : 1);
  a.energy = Math.min(100, a.energy + 3 + (move.field === "wild" ? 5 : 0)); d.energy = Math.min(100, d.energy + 4);
  if (move.drain) a.hp = Math.min(a.b.hp, a.hp + damage * move.drain / 100);
  m.events.push({ kind: "hit", by, move: move.name, slot: move.slot, fx: move.fx, field: move.field, damage, guarded, rear, at: { ...at } });
  if (guarded) { d.stamina -= power / 100; return; }
  mark(d, move.field, damage);

  // Super armour: a heavy body winding up a big move takes a light hit without flinching (dread gets through).
  if (!rear && move.field !== "shadow" && d.state === "attack" && d.act && d.act.move.power >= 60 && power < 70 && d.b.armour > 0.3) return;
  const up = Math.min(0.95, (move.slot === "launcher" ? 0.9 : move.slot === "heavy" || move.slot === "ultimate" ? 0.45 : 0.25) + (move.field === "gale" ? 0.15 : 0));
  const kb = (2.5 + power * 0.05) * (1 + d.launch / 80) * Math.pow(70 / (d.b.mass + 10), 0.4) * (1 - d.b.armour * 0.4) * (move.field === "tide" ? 1.2 : 1);
  const ang = angleTo(a.pos, d.pos), h = Math.sqrt(1 - up * up);
  d.vel.x = Math.cos(ang) * kb * h; d.vel.z = Math.sin(ang) * kb * h; d.vel.y = kb * up;
  if (d.vel.y > 0) d.onGround = false;
  d.state = "stun"; d.stun = Math.round(10 + power / 6 + d.launch / 12 + (rear ? 4 : 0) + (move.field === "storm" ? 6 : 0)); d.act = null; d.t = 0;
  if (d.flying && power >= 70) { d.flying = false; d.clipped = 3 * HZ; m.events.push({ kind: "clipped", who: by ? 0 : 1 }); }
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

function shots(m: Match) {
  for (const s of m.shots) {
    const t = m.f[s.owner ? 0 : 1];
    const want = Math.atan2(t.pos.z - s.pos.z, t.pos.x - s.pos.x), sp = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
    const yaw = turn(Math.atan2(s.vel.z, s.vel.x), want, s.homing * DT);
    const pitch = turn(Math.asin(clamp(s.vel.y / sp, -1, 1)), Math.atan2(t.pos.y + t.b.height / 2 - s.pos.y, Math.max(0.5, flat(s.pos, t.pos))), s.homing * DT);
    s.vel = { x: Math.cos(yaw) * Math.cos(pitch) * sp, y: Math.sin(pitch) * sp, z: Math.sin(yaw) * Math.cos(pitch) * sp };
    s.pos.x += s.vel.x * DT; s.pos.y += s.vel.y * DT; s.pos.z += s.vel.z * DT; s.life--;
    const cy = t.pos.y + t.b.height / 2;
    if (t.invuln === 0 && Math.hypot(s.pos.x - t.pos.x, (s.pos.y - cy) * 0.7, s.pos.z - t.pos.z) < s.radius + t.b.radius) {
      hit(m, s.owner, s.move, s.power, s.pos); s.life = 0;
    }
  }
  // Clash: two shots that meet push against each other; the stronger one goes on, weaker by what it beat.
  for (const a of m.shots) for (const b of m.shots) {
    if (a.owner !== 0 || b.owner !== 1 || a.life <= 0 || b.life <= 0) continue;
    if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z) > a.radius + b.radius) continue;
    m.events.push({ kind: "clash", at: { ...a.pos } });
    const [win, lose] = a.power >= b.power ? [a, b] : [b, a];
    win.power -= lose.power; lose.life = 0;
    if (win.power < 10) win.life = 0;
  }
  m.shots = m.shots.filter((s) => s.life > 0 && s.pos.y > ARENA.fallKo);
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
  shots(m);
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

