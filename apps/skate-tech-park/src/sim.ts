// The ride as a pure fixed-step simulation: no three.js, no DOM, so the tests drive it headless
// and the page only draws what it says. One giant fingerboard, one physics.
//
// The rocket roadster is a skin over that board: its ten cold-gas thrusters (four at the back, four
// under the corners, two at the nose) fire in time with what the board does, as if the rockets did
// the tricks. `firing` is derived from the board's state after each step and never feeds back, so
// swapping skins changes nothing in the ride.
import { clamp } from "@rustybuns/util";
import { across, GRIND_NAME, GRIND_POINTS, type GrindKind, grindFor, LEDGE_NAME, landing, leanStep, restOf, tippiness } from "./grinds.ts";
import { BOARD, FOOT, hitObstacle, type Level, nextRail, onRail, railY } from "./level.ts";
import { plaza } from "./levels/plaza.ts";
import { type Flick, flickLong, TRICKS } from "./tricks.ts";

export type { Flick };

export const DT = 1 / 60;
const G = 20; // gamey gravity: snappier than 9.8

/** How many times bigger the board is than the one these numbers were cut for. Lengths grow by
 * SCALE, so under the same gravity speeds and times grow by its square root (`T`): an ollie goes
 * SCALE times as high and hangs T times as long, and a trick takes T times as long to turn. */
export const SCALE = 2; // a toy twice the size: 3 and up need the trick and rail journeys retimed
const T = Math.sqrt(SCALE);

/** Which skin is drawn. step() never reads it: the same inputs give the same ride in either. */
export type Mode = "skate" | "car";

export type Input = {
  throttle: number; // -1..1
  steer: number; // -1..1, left is +
  jump: boolean; // ollie, on press
  nollie: boolean; // the ollie off the nose: the front foot pops it and the back foot drags it level (on press)
  boost: boolean; // rear jets: speed on the ground and along the heading in the air, and a pump through a transition (held)
  flip: boolean; // board: kickflip (on press, in the air); shorthand for flick "kickflip"
  flick: Flick | null; // board: a flick trick, on press, in the air (the gesture layer resolves a drag or stick into this)
  fan: boolean; // the suction fan, held: sticks the board to banks and walls at speed
  manual: -1 | 0 | 1; // held on the ground: 1 balances on the back wheels (manual), -1 on the front (nose manual)
};

export const IDLE: Input = { throttle: 0, steer: 0, jump: false, nollie: false, boost: false, flip: false, flick: null, fan: false, manual: 0 };

// Pushing is gentle and tops out at a speed you can steer at (about 70 km/h at SCALE 2). The jets and
// a downhill carry the board past it, up to the jets' own top speed, and the board sheds the extra
// slowly once they stop.
const TUNE = { accel: 3, brake: 14, top: 11.5 * T, over: 0.5, turn: 2.2 / T, airSpin: 7 / T };
// The rocket jets, in the board's own numbers.
export const JETS = {
  boost: 32, // m/s² from the rear jets
  boostTop: 48 * T,
  fanTop: 0.6, // the fan holds it to this share of top speed
  fanPull: 26, // m/s² extra downward in the air with the fan on
  fanStep: 1.6, // metres: with the fan on, a kerb, box side or stair this low is driven up
  pop: 0.25, // seconds the lift jets burn on an ollie, and the cushion burst on a landing
  landBurst: 0.15,
};
const BOOST = JETS.boost;
const BOOST_TOP = JETS.boostTop;
/** How far the ground pokes up through the leading half of the deck (the nose, or the tail riding fakie, and both edges). The deck is the
 * plane through the wheels at `y` rising `pitch` per metre ahead, tilted across as the ground under its two halves is (the
 * gentler half, so a box side under one edge is not taken for a sidehill), and tilted it covers less ground. On an even slope
 * nothing pokes through however the board turns; a box side pokes through by its height. */
function poke(level: Level, x: number, z: number, yaw: number, y: number, pitch: number, dir: number) {
  const sn = Math.sin(yaw), cs = Math.cos(yaw), k = 1 / Math.sqrt(1 + pitch * pitch), w = FOOT.halfWid;
  const left = (y - level.height(x - cs * w, z + sn * w)) / w, right = (level.height(x + cs * w, z - sn * w) - y) / w;
  const roll = left * right > 0 ? Math.sign(left) * Math.min(Math.abs(left), Math.abs(right)) : 0;
  let most = 0;
  for (const a of [0, 0.5, 1].map((u) => u * FOOT.halfLen * k * dir)) for (const c of [-w, 0, w]) most = Math.max(most, level.height(x + sn * a + cs * c, z + cs * a - sn * c) - (y + pitch * a + roll * c));
  return most;
}

/** The highest of the board's middle and two tips. The tips are the physics object in the air, so a nose or tail that reaches
 * a wall stops the board there instead of passing through while only its middle is checked. */
function tipContact(level: Level, x: number, z: number, yaw: number) {
  const sn = Math.sin(yaw), cs = Math.cos(yaw);
  let best = { h: level.height(x, z), x, z };
  for (const a of [-FOOT.halfLen, FOOT.halfLen]) {
    const tx = x + sn * a, tz = z + cs * a, h = level.height(tx, tz);
    if (h > best.h) best = { h, x: tx, z: tz };
  }
  return best;
}

/** Is any part of the deck (nose, tail, edges) behind a face from the middle: a rise too sharp for its length, as the ground check counts a wall? */
function deckInFace(level: Level, x: number, z: number, yaw: number) {
  const sn = Math.sin(yaw), cs = Math.cos(yaw);
  for (const a of [-1, -0.5, 0.5, 1].map((k) => k * FOOT.halfLen)) for (const c of [-FOOT.halfWid, 0, FOOT.halfWid]) {
    const n = Math.max(1, Math.ceil(Math.hypot(a, c) / 0.1));
    let prev = level.height(x, z);
    for (let i = 1; i <= n; i++) {
      const h = level.height(x + (sn * a + cs * c) * i / n, z + (cs * a - sn * c) * i / n);
      if (h - prev > Math.max(STEP, 0.1 * MAX_SLOPE)) return true;
      prev = h;
    }
  }
  return false;
}

/** The steepest the face gets over the last `back` metres the board rode to (x, z), along the heading: where a
 * transition curves up to the coping, so a board leaving it is thrown along the face at the lip, not along the coarse
 * average of its last stride (which reads a vertical lip as 70 degrees and throws the board out over the deck). */
function faceAngle(level: Level, x: number, z: number, sx: number, sz: number, back: number) {
  const d = 0.02, from = level.height(x - sx * back, z - sz * back);
  if (level.height(x, z) - from < 2 * back) return 0; // a kerb or stair riser is a step, not a face: a face keeps rising
  let best = 0, prev = from;
  for (let u = -back + d; u <= 1e-9; u += d) { // only what it has ridden: a stair riser just ahead is a wall to meet, not a lip to fly off
    const h = level.height(x + sx * u, z + sz * u);
    best = Math.max(best, Math.atan2(h - prev, d));
    prev = h;
  }
  return best;
}

const MAX_SLOPE = 3; // a rise steeper than this (about 72 degrees) in one stride is a wall, not a ramp
const CARVE = 0.8; // how much speed stiffens the board's turn: at top speed it turns 1/(1+CARVE) as tight
const CARVE_DRAG = 0.5; // a hard carve at speed scrubs this share of it per second
const DRIFT = 0.8; // rad/s the board falls toward downhill per unit of cross slope
const LEG_PUMP = 0.5;
const LEG_PUMP_CAP = 9; // m/s: a leg's push through a transition gains in proportion to speed only up to here; a faster board is heaved no harder (a held push at vert entry speed stays a couple of airs, not a rocket) // the same with legs alone: a held push through a transition, about a tenth more speed out of a quarter pipe
const PUMP = 0.6; // board: speed gained per radian the ground curves up ahead, as a share of speed, while pumping
const WALL = 0.8; // radians: a rider this far up a curve who meets a sharper rise is on a wall, and flies off it
const LIP_PUSH = 0.3; // share of its speed a pushing board keeps toward the deck as it leaves a vertical wall, so it clears the coping instead of climbing the face
const VERT = 1.35; // radians: a wall this steep is vertical
const LEAN = 0.2; // m/s a board leaves a vertical wall drifting back toward it: whatever the air, it comes down on the face just under the coping
const SHEER = 1.25; // radians: a face this steep (a vertical ramp, a cliff) stops a board in the air; anything gentler it lands on and climbs
const STEP = 0.2; // a kerb or stair this low is always rideable
const CURVED = 0.02; // 1/m: ground curving up this tightly along the heading is a transition, where a foot can't push (a plain slope is no curve)
const COYOTE = 0.12; // seconds after the wheels leave the ground that an ollie still pops
const ROLL_OVER = 1.5 * SCALE; // metres: pushing on carries the board over the coping onto the deck only when it would rise no higher than this above it; faster is a vert air
const PUSH_STEEP = 0.6; // radians: a transition steeper than this can't be pushed up, only pumped (a foot can't reach the ground on a wall)

export const FLICK_TIME = 0.24 * T;
/** How long a flick takes: a 360 comes round slower. */
export const flickTime = (k: Flick) => FLICK_TIME * (flickLong(k) ? 1.4 : 1);
const OLLIE = 5.6 * T; // m/s up off the tail
const SPIN_EASE = 0.12; // seconds for a spin in the air to build to what the steering asks, or to slow when let go
/** An ollie's pop, in the board's own time: the back foot snaps the tail down so the nose kicks up
 * `angle` radians in `snap` seconds, then the front foot drags up the grip and levels it out over
 * `level` seconds. The board flattens itself; nobody has to catch it. */
export const POP = { angle: 0.5, snap: 0.07 * T, level: 0.32 * T };
const NOLLIE_BONUS = 100; // popping off the nose is the harder way round
const CATCH = 0.3; // land with less than this share of a flick left and the board is caught flat, not a bail
const CHAIN_WINDOW = 3; // seconds on the ground between tricks before the chain ends
const CHAIN_MAX = 8;
const SLOPE = 1.5; // lean the bar's grade pulls toward, per unit of grade
const LINK = 1.5; // a trick of a different kind from the last in the chain (grind, manual, air) scores this much more

export { grindKind, type GrindKind } from "./grinds.ts";
const ROLL = 0.18; // m/s² the wheels lose rolling with nobody pushing
const DRAG = 0.002; // per metre: the air's share, growing with the square of speed
const MANUAL_MIN = 2; // m/s: slower than this and the board just drops back onto its wheels
const MANUAL_POINTS = 150; // a second

/** Which thruster groups burn this step: all derived from the board. `roll` is the corner jets firing unevenly through a flip (+1 kickflip, -1 heelflip). */
export type Firing = { rear: boolean; lift: boolean; spin: -1 | 0 | 1; roll: -1 | 0 | 1 };

/** Where a foot works the board: the back foot pops the tail or scoops it (a shove-it), the front foot
 * drags to the nose to level an ollie or flicks off one side of it. Left is the board's own left. */
export type Spot = "tail" | "nose" | "nose-left" | "nose-right";
export type Foot = { foot: "back" | "front"; at: Spot };

export type State = {
  t: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; // forward is (sin yaw, cos yaw)
  lip: number; // radians the board points up the wall it left, easing level in the air (0 off the ground)
  pitch: number; // radians the ground rises ahead of the rider (nose up is +)
  roll: number; // radians the ground rises to the rider's right (leaning left is +)
  speed: number; // signed, along yaw, while on the ground
  air: boolean;
  airTime: number;
  spun: number; // radians turned in this air
  spin: number; // rad/s the board is turning: carried off the ground from a carve, built and slowed by steering in the air
  flipT: number; // seconds left in the current flick trick
  flipKind: Flick; // which one (for the view)
  tricks: Flick[]; // flick tricks finished in this air
  grind: number; // -1, or the rail being ground
  grindTime: number;
  grindKind: GrindKind;
  grindOff: number; // radians the board sits across the bar (boardslide), for the view
  balance: number; // -1..1 on a grind or a manual; at either end the rider falls off
  lean: number; // how fast it is tipping, per second
  push: number; // the correction the body has made so far, lagging the stick
  grindAt: number; // -1 tail tip to 1 nose tip: the part of the deck over the bar
  grindSide: number; // which way the grind rests over
  manual: -1 | 0 | 1; // which manual is being held, if any
  manualTime: number; // seconds in it
  chain: number; // tricks landed in a row; the score multiplier
  chainT: number; // seconds left to extend it
  combo: string[]; // the tricks in the running chain, in order
  comboScore: number; // what the running chain has scored so far
  comboKind: TrickKind | null; // what the last trick in it was
  fan: boolean; // the suction fan is on
  jetT: number; // seconds the lift jets still burn (an ollie, a landing)
  firing: Firing;
  popT: number; // seconds since the last ollie's pop, or -1 once the board is level again
  nollie: boolean; // this air was popped off the nose
  feet: Foot[]; // what the feet did this step, for the view
  plateDown: boolean;
  bail: number; // seconds left on the floor
  tumbleDir: 1 | -1; // which way the fall rolls
  score: number;
  last: { name: string; points: number } | null;
  prevJump: boolean;
  prevFlip: boolean;
  prevFlick: boolean;
};

export function start(x = 0, z = -20, yaw = 0, level: Level = plaza): State {
  return {
    t: 0, x, y: level.height(x, z), z, vx: 0, vy: 0, vz: 0, yaw, lip: 0, pitch: 0, roll: 0, speed: 0,
    air: false, airTime: 0, spun: 0, spin: 0, flipT: 0, flipKind: "kickflip", tricks: [], grind: -1, grindTime: 0,
    grindKind: "50-50", grindOff: 0, balance: 0, lean: 0, push: 0, grindAt: 0, grindSide: 1, manual: 0, manualTime: 0, chain: 0, chainT: 0, combo: [], comboScore: 0, comboKind: null, fan: false, jetT: 0,
    firing: { rear: false, lift: false, spin: 0, roll: 0 }, popT: -1, nollie: false, feet: [], plateDown: false,
    bail: 0, tumbleDir: 1, score: 0, last: null, prevJump: false, prevFlip: false, prevFlick: false,
  };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** How far the board's nose is up over its path from an ollie's pop: up fast as the tail snaps, then eased level. A nollie is the same pop the other way: the tail kicks up (negative). */
export function noseUp(s: Pick<State, "popT" | "nollie">): number {
  if (s.popT < 0) return 0;
  const way = s.nollie ? -1 : 1;
  if (s.popT < POP.snap) return way * POP.angle * (s.popT / POP.snap);
  const u = (s.popT - POP.snap) / POP.level;
  return u >= 1 ? 0 : way * POP.angle * (1 - u) ** 2;
}

/** The ollie: the tail snaps (the nose, on a nollie), the lift jets burn, and the board leaves the ground. */
function pop(s: State, nollie: boolean) {
  s.vy = Math.max(0, s.vy) + OLLIE; s.jetT = JETS.pop; s.popT = 0; s.nollie = nollie; // off a kicker's lip the pop adds to the climb
  s.feet.push(nollie ? { foot: "front", at: "nose" } : { foot: "back", at: "tail" });
  takeOff(s);
}

export type TrickKind = "air" | "grind" | "manual";

function endChain(s: State) {
  s.chain = 0; s.chainT = 0; s.combo = []; s.comboScore = 0; s.comboKind = null;
}

/** Score a trick; each one landed within the window of the last is multiplied by how long the chain is,
 * and more again if it is a different kind of trick from the one before (grind to manual to air). */
function award(s: State, name: string, points: number, kind: TrickKind) {
  if (s.chainT <= 0) endChain(s);
  const linked = s.comboKind !== null && s.comboKind !== kind;
  s.chain = s.chain > 0 ? Math.min(CHAIN_MAX, s.chain + 1) : 1;
  s.chainT = CHAIN_WINDOW;
  const total = Math.round(points * s.chain * (linked ? LINK : 1));
  s.combo.push(name); s.comboScore += total; s.comboKind = kind;
  s.last = { name: s.chain > 1 ? `${name} x${s.chain}${linked ? " link" : ""}` : name, points: total };
  s.score += total;
}

export const BAIL_TIME = 1.2;
const SKID = 2.4; // per second: how fast a fall's slide bleeds off on the ground

/** Fall: wipe the chain and keep the momentum, so the rider slides and tumbles on (`vx`/`vz` carry on),
 * then gets back up after `BAIL_TIME`. */
function bail(s: State, name: string) {
  s.bail = BAIL_TIME;
  s.tumbleDir = Math.sin(s.yaw) * s.vz - Math.cos(s.yaw) * s.vx >= 0 ? 1 : -1; // roll toward the side it was sliding
  s.speed = 0;
  s.flipT = 0; s.popT = -1; s.grind = -1; s.manual = 0; endChain(s);
  s.last = { name, points: 0 };
}

/** How the fall looks `bail` seconds in: a roll over the ground that eases to lying flat, the body hopping
 * as it hits, then standing back up. `roll` is radians about the board's length. */
export function tumble(s: Pick<State, "bail" | "tumbleDir">): { roll: number; hop: number } {
  const u = clamp(1 - s.bail / BAIL_TIME, 0, 1);
  const ease = (x: number) => 1 - (1 - clamp(x, 0, 1)) ** 3;
  const LIE = 1.3;
  if (u < 0.75) {
    const p = u / 0.75;
    return { roll: s.tumbleDir * (LIE + 2 * Math.PI) * ease(p), hop: 0.4 * Math.abs(Math.sin(p * Math.PI * 3)) * (1 - p) };
  }
  return { roll: s.tumbleDir * LIE * (1 - ease((u - 0.75) / 0.25)), hop: 0 };
}

/** Run into something solid: stop against it (no rebound, so pushing on never jitters the board back and forth), and bail if it was fast and the thing was worth a name. */
function crash(s: State, name: string | null) {
  s.vy = 0;
  if (name && Math.abs(s.speed) > 6 * T) { bail(s, name); s.vx = s.vz = 0; return s; }
  s.speed = 0; s.vx = s.vz = 0;
  return s;
}

/** Set the board back on all four wheels: a manual held for more than half a second is a trick. */
function endManual(s: State) {
  if (s.manualTime > 0.5) award(s, s.manual > 0 ? "Manual" : "Nose manual", Math.round(s.manualTime * MANUAL_POINTS), "manual");
  s.manual = 0; s.manualTime = 0;
}

function takeOff(s: State) {
  if (s.manual) endManual(s);
  s.air = true;
  s.airTime = 0; s.spun = 0; s.tricks = [];
}

function land(s: State, level: Level) {
  s.lip = 0;
  // The ground takes the part of the velocity into it; the part along it carries on as speed, so a drop into a
  // transition or down a slope rolls away fast, and a fall straight onto flat ground stops. What faces along the
  // heading is the speed; landed across the heading it is a bail.
  const [gx, gz] = gradient(level, s.x, s.z), into = (s.vy - gx * s.vx - gz * s.vz) / (1 + gx * gx + gz * gz);
  const vx = s.vx + gx * into, vz = s.vz + gz * into, vy = s.vy - into;
  s.vx = vx; s.vz = vz; // a fall slides on along the ground
  s.y = level.height(s.x, s.z); s.vy = 0; s.air = false; s.popT = -1;
  const nollie = s.nollie; s.nollie = false;
  if (s.airTime > 0.2) s.jetT = JETS.landBurst;
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), a = gx * fx + gz * fz;
  s.pitch = Math.atan(a); s.roll = Math.atan(gx * fz - gz * fx);
  const hs = Math.hypot(vx, vz), along = (vx * fx + vz * fz + vy * a) / Math.sqrt(1 + a * a); // along the surface under the heading
  const off = Math.abs(wrap(Math.atan2(vx, vz) - s.yaw));
  if (s.flipT > 0 && s.flipT < flickTime(s.flipKind) * CATCH) { s.flipT = 0; s.tricks.push(s.flipKind); } // nearly round: it lands bolts
  if (s.flipT > 0) return bail(s, "Bail: still flipping");
  if (hs >= 2 && off > 0.9 && off < Math.PI - 0.9) return bail(s, "Bail: landed sideways");
  s.speed = along; // (slowly, onto a wall: it just rolls off whichever way it faces)
  if (s.airTime < 0.35) return;
  const turns = Math.round(Math.abs(s.spun) / Math.PI) * 180;
  const parts: string[] = [];
  const big = turns === 180 && s.tricks.length === 1 && s.tricks[0] === "tre flip"; // a tre flip with the rider turning 180 too
  if (turns >= 180 && !big) parts.push(String(turns));
  if (big) parts.push("big flip");
  else for (const t of new Set(s.tricks)) {
    const n = s.tricks.filter((x) => x === t).length;
    parts.push(n > 1 ? `${n}x ${t}` : t);
  }
  if (s.speed < 0) parts.push("fakie");
  if (nollie) parts.unshift("nollie");
  const points = Math.round(s.airTime * 100 + (turns / 180) * 250 + s.tricks.reduce((n, t) => n + TRICKS[t].points, 0) + (nollie ? NOLLIE_BONUS : 0));
  award(s, parts.length ? parts.join(" ") : "Air", points, "air");
}

/** The floor's rise per metre in x and z, by central difference. */
function gradient(level: Level, x: number, z: number): [number, number] {
  const e = 0.25;
  return [(level.height(x + e, z) - level.height(x - e, z)) / (2 * e), (level.height(x, z + e) - level.height(x, z - e)) / (2 * e)];
}

/** The slide of a fall: carry on along the old heading, bleeding speed, stopping dead at a wall or a tree. */
function skid(s: State, level: Level) {
  const k = Math.exp(-SKID * DT);
  s.vx *= k; s.vz *= k; s.vy = 0;
  const nx = s.x + s.vx * DT, nz = s.z + s.vz * DT, b = level.bounds, h = level.height(nx, nz);
  if (hitObstacle(level, nx, nz, s.y) || h - s.y > STEP || nx < b.minX || nx > b.maxX || nz < b.minZ || nz > b.maxZ) { s.vx = s.vz = 0; return; }
  s.x = nx; s.z = nz; s.y = h;
}

/** One fixed step on `level` (the plaza unless told otherwise). Mutates and returns `s`. */
export function step(s: State, inp: Input, level: Level = plaza): State {
  const tune = TUNE;
  const pops = inp.jump || inp.nollie, pressed = pops && !s.prevJump;
  const flipPressed = inp.flip && !s.prevFlip;
  const flick = inp.flick ?? (flipPressed ? "kickflip" : null);
  const flickPressed = flick !== null && (!inp.flick || !s.prevFlick);
  s.prevJump = pops; s.prevFlip = inp.flip; s.prevFlick = inp.flick !== null;
  s.t += DT;
  s.firing = { rear: false, lift: false, spin: 0, roll: 0 };
  s.feet = [];
  if (s.popT >= 0) {
    const was = s.popT;
    s.popT += DT;
    if (was < POP.snap && s.popT >= POP.snap) s.feet.push(s.nollie ? { foot: "back", at: "tail" } : { foot: "front", at: "nose" }); // the other foot drags it level
    if (s.popT > POP.snap + POP.level) s.popT = -1;
  }

  if (s.chainT > 0 && !s.air && s.grind < 0 && !s.manual && (s.chainT -= DT) <= 0) endChain(s); // the clock only runs on the ground, and a held manual keeps the chain alive
  if (s.bail > 0) {
    s.bail -= DT;
    s.plateDown = false;
    s.fan = false;
    skid(s, level);
    return s;
  }

  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  if (s.jetT > 0) { s.jetT = Math.max(0, s.jetT - DT); s.firing.lift = true; } // an ollie's pop, a landing's cushion
  const boosting = inp.boost;
  s.plateDown = boosting;
  s.fan = inp.fan;

  if (s.grind >= 0) {
    const r = level.rails[s.grind];
    const ledge = r.kind === "ledge"; // a ledge is smooth: it slides further and forgives more
    s.grindTime += DT;
    const slide = (ledge ? 0.12 : 0.25) * G * DT; // sliding friction: a constant deceleration, not a share of speed
    s.speed = Math.abs(s.speed) <= slide ? 0 : s.speed - Math.sign(s.speed) * slide;
    { // a lean to hold: the kind sets where it balances and how it tips, the bar's slope pulls it, speed steadies it
      const o = onRail(r, s.x, s.z), grade = (((r.y2 ?? r.y) - r.y) / o.len) * (fx * o.dx + fz * o.dz);
      leanStep(s, s.grindSide * restOf(s.grindKind) - Math.max(-0.5, Math.min(0.5, SLOPE * grade)), tippiness(s.grindKind) * (ledge ? 0.5 : 1), s.speed, inp.steer, DT);
    }
    s.x += fx * s.speed * DT; s.z += fz * s.speed * DT;
    const t = onRail(r, s.x, s.z).t, y0 = s.y;
    s.y = railY(r, t);
    const v2 = s.speed * s.speed - 2 * G * (s.y - y0); // a bar down the stairs speeds the slide up; one climbing slows it
    s.speed = Math.sign(s.speed) * Math.sqrt(Math.max(0, v2));
    if (Math.abs(s.balance) >= 1) {
      const side = Math.sign(s.balance) * (BOARD.halfWid + 0.2); // off the bar's line, the whole deck clear of its posts, so the fall doesn't land inside one and pin the board
      s.x += fz * side; s.z -= fx * side;
      s.y = level.height(s.x, s.z); s.vx = fx * s.speed; s.vz = fz * s.speed; bail(s, `Bail: fell off the ${ledge ? "ledge" : "rail"}`);
      return s;
    }
    s.firing.rear = s.speed > 1; // the jets hold the slide
    const next = !pressed && (t < 0 || t > 1) && s.speed > 0.5 ? nextRail(level.rails, s.grind, t > 1) : null;
    if (next) { // a bent bar: round the joint and on along the next segment, keeping the grind going
      const q = level.rails[next.i]!, o = onRail(q, s.x, s.z), turn = Math.abs(wrap(Math.atan2(next.dir * o.dx, next.dir * o.dz) - s.yaw));
      if (turn < 1.8) {
        const e = next.dir > 0 ? q.a : q.b;
        s.grind = next.i; s.yaw = Math.atan2(next.dir * o.dx, next.dir * o.dz); s.x = e.x; s.z = e.z; s.y = railY(q, next.dir > 0 ? 0 : 1);
        return s;
      }
    }
    if (pressed || t < 0 || t > 1 || Math.abs(s.speed) < 0.5) { // off either end, popped off, or stalled on a climbing bar
      if (s.grindTime > 0.2) award(s, (ledge ? LEDGE_NAME : GRIND_NAME)[s.grindKind], Math.round(s.grindTime * GRIND_POINTS[s.grindKind]), "grind");
      s.grind = -1;
      if (!pressed && t >= 0 && t <= 1) { const side = (Math.sign(s.balance) || 1) * (BOARD.halfWid + 0.2); s.x += fz * side; s.z -= fx * side; } // stalled on the bar: it steps off the side rather than dropping back onto it
      s.vx = fx * s.speed; s.vz = fz * s.speed;
      s.vy = 0;
      if (pressed) pop(s, inp.nollie); else takeOff(s);
    }
    return s;
  }

  if (!s.air) {
    // a manual: balance on two wheels. It drifts toward tipping over; push or brake to hold it
    if (inp.manual && !s.manual && Math.abs(s.speed) > MANUAL_MIN) { s.manual = inp.manual; s.manualTime = 0; s.balance = 0; s.lean = 0.6; s.push = 0; } // the pop that lifts the wheels tips it a little
    if (s.manual) {
      s.manualTime += DT;
      s.speed *= 1 - 0.1 * DT;
      leanStep(s, 0.05, 1, s.speed, inp.throttle * s.manual, DT); // pushing or braking tips the nose and tail back
      if (inp.manual !== s.manual || Math.abs(s.speed) < MANUAL_MIN) endManual(s);
      else if (Math.abs(s.balance) >= 1) { s.vx = fx * s.speed; s.vz = fz * s.speed; bail(s, `Bail: lost the ${s.manual > 0 ? "manual" : "nose manual"}`); return s; }
    }
    const push = s.fan ? tune.top * JETS.fanTop : tune.top; // what pushing alone reaches
    const top = s.fan ? push : BOOST_TOP; // the most a downhill or the jets can carry it to
    const fakie = s.speed < -1, k = 0.5, curve = (level.height(s.x + fx * k, s.z + fz * k) - 2 * level.height(s.x, s.z) + level.height(s.x - fx * k, s.z - fz * k)) / (k * k),
      foot = Math.abs(s.pitch) < PUSH_STEEP && curve < CURVED; // a foot only reaches the ground off a wall, or a curve up one
    if (fakie) { // rolling backwards (back down off a wall): push on the way it rolls, and S brakes
      if (inp.throttle < 0) s.speed = Math.min(0, s.speed - inp.throttle * tune.brake * DT);
      else if (inp.throttle > 0 && foot && s.speed > -push * 0.5) s.speed -= inp.throttle * tune.accel * DT; // pushing fakie only goes so fast
    } else if (inp.throttle < 0 && s.speed > 0) s.speed += inp.throttle * tune.brake * DT;
    else if (foot && (inp.throttle > 0 ? s.speed < push : inp.throttle < 0 && s.speed > -push * 0.5)) s.speed += inp.throttle * tune.accel * DT;
    if (boosting) s.speed += BOOST * DT;
    else if (Math.abs(s.speed) > push) s.speed -= Math.sign(s.speed) * (Math.abs(s.speed) - push) * tune.over * DT;
    if (!inp.throttle && !boosting) s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), (ROLL + DRAG * s.speed * s.speed) * DT);
    s.speed = clamp(s.speed, -top, top); // rolling back down a wall fakie is as fast as rolling down it forwards
    const dir = Math.sign(s.speed || 1);
    const [gx, gz] = gradient(level, s.x, s.z);
    const along = gx * fx + gz * fz, across = gx * fz - gz * fx; // rise ahead, and to the right
    const pitched = Math.atan(along) - s.pitch;
    s.roll = Math.atan(across); // (pitch is the wheels' own track, kept from the last step: it follows a curve where the gradient overshoots)
    // pumping: weight the board as the floor curves up under it and the curve gives back speed
    const pump = inp.boost ? PUMP : inp.throttle > 0 ? LEG_PUMP : 0; // held through a transition, a push is a pump (the jets pump far harder than legs)
    if (pump) s.speed += dir * pump * (inp.boost ? Math.abs(s.speed) : Math.min(Math.abs(s.speed), LEG_PUMP_CAP)) * Math.max(0, pitched * dir);
    const yaw0 = s.yaw; // where the footprint was before it turned: turning into a wall is meeting the wall
    { // the board carves: weight over the trucks, tighter when fast, and it falls toward downhill
      const load = Math.abs(s.speed) / tune.top;
      s.yaw += inp.steer * tune.turn * DT * Math.min(1, Math.abs(s.speed) / (3 * T)) * dir / (1 + CARVE * load);
      s.yaw -= DRIFT * across * DT * Math.min(1, Math.abs(s.speed) / (3 * T)) * dir;
      s.speed *= 1 - CARVE_DRAG * Math.abs(inp.steer) * load * DT;
    }
    s.firing.rear = boosting || (inp.throttle > 0 && s.speed < tune.top);
    s.spin = (s.yaw - yaw0) / DT; // a carve's turn carries into the air off a lip

    const sx = Math.sin(s.yaw), sz = Math.cos(s.yaw);
    const blocker = hitObstacle(level, s.x + sx * s.speed * DT, s.z + sz * s.speed * DT, s.y, s.yaw);
    if (blocker) { s.yaw = yaw0; return crash(s, blocker.kind === "post" ? "Hit a rail post" : "Hit a tree"); }
    // Ride the surface in 10 cm strides, so the slope under the board is fresh at every one. `speed` is along the
    // surface: a stride covers less ground the steeper it climbs, and the height it gains or loses is paid for out
    // of speed (v² - 2gh), so a transition gives back on the way down exactly what it took on the way up.
    const n = Math.max(1, Math.ceil(Math.abs(s.speed * DT) / 0.1)), dt = DT / n;
    let slope = Math.tan(s.pitch) * dir; // the rise per metre along the path the board is riding
    let vy = s.vy;
    const kerb = s.fan ? JETS.fanStep : STEP; // the fan sucks it up a kerb or box side this high
    const offTheLip = (v: number, steep0: number) => { // up the face and out over the coping: it keeps a share of its speed toward the deck, so it clears the lip instead of climbing the face
      const face = faceAngle(level, s.x, s.z, sx * dir, sz * dir, 0.3), steep = Math.max(steep0, face); // vert is the face it rode, not a riser it met
      const roll = inp.throttle > 0 && (v * Math.sin(steep)) ** 2 / (2 * G) <= ROLL_OVER; // only just reaching the coping, a push rolls it over onto the deck
      const c = face > VERT && !roll ? -LEAN / Math.max(v, 1) : Math.max(Math.cos(steep), LIP_PUSH); // a true vert wall throws it straight up and a hair back over the face so it drops back in
      s.vx = sx * v * c * dir; s.vz = sz * v * c * dir; s.vy = v * Math.sqrt(1 - c * c);
      takeOff(s);
      s.lip = Math.min(steep, 1.4) * dir;
      return s;
    };
    let wallPrev = poke(level, s.x, s.z, yaw0, s.y, slope * dir, dir);
    for (let i = 0; i < n; i++) {
      const v0 = s.speed, run = v0 * dt / Math.sqrt(1 + slope * slope);
      const px = s.x + sx * run, pz = s.z + sz * run, h = level.height(px, pz);
      vy = Math.abs(v0) * slope / Math.sqrt(1 + slope * slope); // the board's own climb, along the surface it was on
      if (h < s.y + vy * dt - G * dt * dt / 2 - 0.004 && !s.fan) { // the floor fell away faster than the board falls: off a lip, an edge or a crest (the fan holds it down)
        if (Math.atan(slope) >= WALL && vy > 0) return offTheLip(Math.abs(v0), Math.atan(slope)); // over the top of a vert wall
        s.vx = sx * (run / dt); s.vz = sz * (run / dt); s.vy = vy;
        takeOff(s);
        break;
      }
      const wall = poke(level, px, pz, s.yaw, h, slope * dir, dir); // a box side meeting the nose, tail or an edge
      const climbing = Math.atan(slope) >= WALL, sharp = Math.max(kerb, Math.abs(run) * MAX_SLOPE);
      if (!climbing && Math.atan(slope) < 0.4 && wall - wallPrev > sharp) { s.yaw = yaw0; return crash(s, null); } // the board stays as it was, not turned into the wall
      wallPrev = wall;
      if (h - s.y > sharp) {
        // a rise this sharp from flat is a wall (the side of a box); met while already climbing a curve, it is the lip of a vert wall
        // (high on a curve the deck's ends overhang it, so only the wheels' own track says where the lip is)
        if (!climbing) { s.yaw = yaw0; return crash(s, null); }
        return offTheLip(Math.abs(v0), Math.max(Math.atan(slope), Math.atan((h - s.y) / Math.max(1e-6, Math.abs(run)))));
      }
      const dh = h - s.y, v2 = v0 * v0 - 2 * G * dh;
      if (v2 > 0 && v0 !== 0) s.speed = Math.sign(v0) * Math.sqrt(v2);
      else { const [gx, gz] = gradient(level, px, pz), a = gx * sx + gz * sz; s.speed = v0 - G * (a / Math.sqrt(1 + a * a)) * dt; } // at rest or turning back: the slope pulls it downhill
      if (Math.abs(run) > 1e-4) slope = dh / Math.abs(run);
      s.x = px; s.z = pz; s.y = h;
    }
    if (!s.air) {
      s.vx = sx * s.speed / Math.sqrt(1 + slope * slope); s.vz = sz * s.speed / Math.sqrt(1 + slope * slope); s.vy = vy;
      if (Math.abs(s.speed * DT) > 0.01) s.pitch = Math.atan(slope * dir);
      else { const [gx, gz] = gradient(level, s.x, s.z); s.pitch = Math.atan(gx * sx + gz * sz); } // standing still: the ground's own slope
    }
    if (!s.air && pressed) {
      if (s.pitch * dir >= WALL && s.speed * dir > 0) { s.speed += dir * OLLIE * 0.5; s.jetT = JETS.pop; s.popT = 0; s.feet.push({ foot: "back", at: "tail" }); } // up a steep wall the pop drives it on up the face, for a higher air off the lip
      else pop(s, inp.nollie);
    }
  }

  if (s.air) {
    if (pressed && s.popT < 0 && s.airTime < COYOTE && s.flipT <= 0 && !s.tricks.length) pop(s, inp.nollie); // the wheels only just left a bump or a lip: the tail still reaches it
    s.airTime += DT;
    if (s.lip) s.lip = Math.max(0, Math.min(s.lip, Math.atan2(s.vy, Math.hypot(s.vx, s.vz)))); // nose along its path off the wall, levelling as it turns over
    s.vy -= (G + (s.fan ? JETS.fanPull : 0)) * DT;
    if (!s.lip) s.pitch *= Math.exp(-DT / 0.12); // the nose comes level in the air instead of keeping the wall's angle until it lands
    if (boosting) { s.vx += fx * BOOST * DT; s.vz += fz * BOOST * DT; s.firing.rear = true; }
    s.spin += (inp.steer * tune.airSpin - s.spin) * Math.min(1, DT / SPIN_EASE); // the board has weight: a spin winds up and winds down
    s.yaw += s.spin * DT; s.spun += s.spin * DT;
    if (inp.steer) s.firing.spin = inp.steer > 0 ? 1 : -1;
    if (flickPressed && flick && s.flipT <= 0) {
      s.flipT = flickTime(flick); s.flipKind = flick;
      const { board, flip } = TRICKS[flick];
      if (board) s.feet.push({ foot: "back", at: "tail" });
      if (flip) s.feet.push({ foot: "front", at: flip > 0 ? "nose-left" : "nose-right" });
    }
    if (s.flipT > 0) {
      const { board, flip } = TRICKS[s.flipKind];
      if (board) s.firing.spin = board > 0 ? 1 : -1; // the nose jets turn it
      if (flip) { s.firing.lift = true; s.firing.roll = flip; } // the corners fire unevenly
      s.flipT -= DT; if (s.flipT <= 0) { s.flipT = 0; s.tricks.push(s.flipKind); } }
    const hit = hitObstacle(level, s.x + s.vx * DT, s.z + s.vz * DT, s.y + s.vy * DT, s.yaw);
    if (hit) { s.vx = s.vz = 0; s.speed = 0; } // thrown against the trunk: drop down it
    s.x += s.vx * DT; s.y += s.vy * DT; s.z += s.vz * DT;

    { // dropping onto a rail starts a grind; a bar climbing faster than you fall meets you from below just the same
      const i = level.rails.findIndex((r) => {
        const o = onRail(r, s.x, s.z), climb = (((r.y2 ?? r.y) - r.y) / o.len) * (s.vx * o.dx + s.vz * o.dz); // the bar's own rise under you, m/s
        if (r.kind === "coping" && Math.abs(s.vx * o.dx + s.vz * o.dz) < 2) return false; // straight back down a vert wall it drops past the coping, not onto it
        return s.vy < Math.max(0, climb) && landing(r, s.x, s.z, s.yaw, 1) !== null && Math.abs(s.y - railY(r, o.t)) < 0.25 + Math.max(0, climb - s.vy) * DT;
      });
      if (i >= 0 && s.flipT <= 0) {
        const r = level.rails[i], o = onRail(r, s.x, s.z);
        const dir = s.vx * o.dx + s.vz * o.dz >= 0 ? 1 : -1; // ride the way you came in
        // the angle and the part of the deck over the bar name the grind
        const lg = landing(r, s.x, s.z, s.yaw, dir)!, rel = lg.rel;
        s.grindKind = grindFor(rel, lg.at); s.grindAt = lg.at;
        s.grindOff = across(s.grindKind) ? Math.PI / 2 : 0;
        s.grindSide = Math.sign(rel) || 1;
        const d = o.dx * (s.z - r.a.z) - o.dz * (s.x - r.a.x); // landing off the bar's line starts it rocking that way
        s.balance = 0; s.push = 0; s.lean = 0.5 * s.grindSide + 0.4 * Math.max(-1, Math.min(1, d / BOARD.halfWid));
        s.grind = i; s.grindTime = 0; s.popT = -1; s.spin = 0; // locked onto the bar, flat
        s.x = r.a.x + (r.b.x - r.a.x) * o.t; s.z = r.a.z + (r.b.z - r.a.z) * o.t;
        s.y = railY(r, o.t); s.vy = 0;
        s.speed = Math.max(3, Math.abs(s.vx * o.dx + s.vz * o.dz));
        s.yaw = Math.atan2(dir * o.dx, dir * o.dz);
        s.air = false;
        return s;
      }
    }
    const tip = tipContact(level, s.x, s.z, s.yaw);
    if (s.y < tip.h - STEP && (tip.x - s.x) * s.vx + (tip.z - s.z) * s.vz > 0 && Math.atan((tip.h - level.height(s.x, s.z)) / FOOT.halfLen) >= SHEER) { // a tip met a sheer face: the board stops against it
      s.x -= s.vx * DT; s.z -= s.vz * DT; s.vx = s.vz = 0; s.speed = 0;
    }
    const h = level.height(s.x, s.z);
    if (s.y < h && s.vy > 0) {
      const [gx, gz] = gradient(level, s.x, s.z);
      if (Math.atan(Math.hypot(gx, gz)) >= SHEER) { // flew into a wall: the surface stops the board, it never passes through (a gentler slope is landed on below)
        const k = (s.vy - gx * s.vx - gz * s.vz) / (1 + gx * gx + gz * gz);
        if (k < 0) { s.vx += gx * k; s.vz += gz * k; s.vy -= k; } // keep only the part of the velocity along the surface
        s.y = h;
        if (s.vy > 0 && s.vy < 0.5) s.vy = 0;
      }
    }
    if (s.y <= h && s.vy <= 0) {
      const [gx, gz] = gradient(level, s.x, s.z);
      if (Math.atan(Math.hypot(gx, gz)) < WALL && deckInFace(level, s.x, s.z, s.yaw)) { // (back onto a transition's own face the deck lies along the wall: that's a re-entry) // landed with the deck in a steep face: slide back out along it, stopped against it
        const hs = Math.hypot(s.vx, s.vz), bx = hs > 0.01 ? -s.vx / hs : -Math.sin(s.yaw), bz = hs > 0.01 ? -s.vz / hs : -Math.cos(s.yaw);
        for (let i = 0; i < 80 && deckInFace(level, s.x, s.z, s.yaw); i++) { s.x += bx * 0.1; s.z += bz * 0.1; }
        s.vx = s.vz = 0;
      }
      land(s, level);
    }
  }

  const b = level.bounds;
  if (s.x < b.minX || s.x > b.maxX || s.z < b.minZ || s.z > b.maxZ) { // the wall
    s.x = clamp(s.x, b.minX, b.maxX); s.z = clamp(s.z, b.minZ, b.maxZ);
    s.speed *= -0.3; s.vx *= -0.3; s.vz *= -0.3;
  }
  return s;
}
