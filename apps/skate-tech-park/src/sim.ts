// The ride as a pure fixed-step simulation: no three.js, no DOM, so the tests drive it headless
// and the page only draws what it says. One giant fingerboard, one physics.
//
// The rocket roadster is a skin over that board: its ten cold-gas thrusters (four at the back, four
// under the corners, two at the nose) fire in time with what the board does, as if the rockets did
// the tricks. `firing` is derived from the board's state after each step and never feeds back, so
// swapping skins changes nothing in the ride.
import { clamp } from "@rustybuns/util";
import { hitObstacle, type Level, onRail, railY } from "./level.ts";
import { plaza } from "./levels/plaza.ts";

export const DT = 1 / 60;
const G = 20; // gamey gravity: snappier than 9.8

/** How many times bigger the board is than the one these numbers were cut for. Lengths grow by
 * SCALE, so under the same gravity speeds and times grow by its square root (`T`): an ollie goes
 * SCALE times as high and hangs T times as long, and a trick takes T times as long to turn. */
export const SCALE = 2; // a toy twice the size: 3 and up need the trick and rail journeys retimed
const T = Math.sqrt(SCALE);

/** Which skin is drawn. step() never reads it: the same inputs give the same ride in either. */
export type Mode = "skate" | "car";

export type Flick = "kickflip" | "heelflip" | "shove-it";

export type Input = {
  throttle: number; // -1..1
  steer: number; // -1..1, left is +
  jump: boolean; // ollie, on press
  boost: boolean; // rear jets: speed on the ground and along the heading in the air, and a pump through a transition (held)
  flip: boolean; // board: kickflip (on press, in the air); shorthand for flick "kickflip"
  flick: Flick | null; // board: a flick trick, on press, in the air (the gesture layer resolves a drag or stick into this)
  fan: boolean; // the suction fan, held: sticks the board to banks and walls at speed
  manual: -1 | 0 | 1; // held on the ground: 1 balances on the back wheels (manual), -1 on the front (nose manual)
};

export const IDLE: Input = { throttle: 0, steer: 0, jump: false, boost: false, flip: false, flick: null, fan: false, manual: 0 };

// Pushing is gentle and tops out at a speed you can steer at (about 70 km/h at SCALE 2). The jets and
// a downhill carry the board past it, up to the jets' own top speed, and the board sheds the extra
// slowly once they stop.
const TUNE = { accel: 6, brake: 14, top: 14 * T, over: 0.5, turn: 2.2 / T, airSpin: 7 / T };
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
const MAX_SLOPE = 3; // a rise steeper than this (about 72 degrees) in one stride is a wall, not a ramp
const CARVE = 0.8; // how much speed stiffens the board's turn: at top speed it turns 1/(1+CARVE) as tight
const CARVE_DRAG = 0.5; // a hard carve at speed scrubs this share of it per second
const DRIFT = 0.8; // rad/s the board falls toward downhill per unit of cross slope
const PUMP = 0.6; // board: speed gained per radian the ground curves up ahead, as a share of speed, while pumping
const WALL = 1; // radians: a rider this far up a curve who meets a sharper rise is on a wall, and flies off it
const STEP = 0.2; // a kerb or stair this low is always rideable

const FLICK_POINTS: Record<Flick, number> = { kickflip: 300, heelflip: 300, "shove-it": 200 };
export const FLICK_TIME = 0.45 * T;
const OLLIE = 7 * T; // m/s up off the tail
const CHAIN_WINDOW = 3; // seconds on the ground between tricks before the chain ends
const CHAIN_MAX = 8;
const LINK = 1.5; // a trick of a different kind from the last in the chain (grind, manual, air) scores this much more

export type GrindKind = "50-50" | "boardslide" | "nosegrind" | "5-0";
const GRIND_POINTS: Record<GrindKind, number> = { "50-50": 300, "5-0": 350, nosegrind: 400, boardslide: 450 };
const LEDGE_NAME: Record<GrindKind, string> = { "50-50": "50-50 slide", "5-0": "5-0 slide", nosegrind: "Nose slide", boardslide: "Boardslide" };
const GRIND_NAME: Record<GrindKind, string> = { "50-50": "50-50 grind", "5-0": "5-0 grind", nosegrind: "Nosegrind", boardslide: "Boardslide" };
const BALANCE_DRIFT = 1.1; // how fast a grind pulls off balance per unit of lean, per second
const COAST = 0.2; // share of speed a rolling board loses a second with nobody pushing
const MANUAL_MIN = 2; // m/s: slower than this and the board just drops back onto its wheels
const MANUAL_POINTS = 150; // a second
const BALANCE_PUSH = 3.2; // how hard steering pulls it back

/** What the approach to a rail makes of the grind: `off` is the angle between the rider and the bar, `side` +1 if coming in from its left. */
export function grindKind(off: number, side: number): GrindKind {
  const a = off > Math.PI / 2 ? Math.PI - off : off; // riding the bar backwards is the same trick
  if (a < 0.35) return "50-50";
  if (a > 1.1) return "boardslide";
  return side > 0 ? "nosegrind" : "5-0";
}

/** Which thruster groups burn this step: all derived from the board. `roll` is the corner jets firing unevenly through a flip (+1 kickflip, -1 heelflip). */
export type Firing = { rear: boolean; lift: boolean; spin: -1 | 0 | 1; roll: -1 | 0 | 1 };

export type State = {
  t: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; // forward is (sin yaw, cos yaw)
  pitch: number; // radians the ground rises ahead of the rider (nose up is +)
  roll: number; // radians the ground rises to the rider's right (leaning left is +)
  speed: number; // signed, along yaw, while on the ground
  air: boolean;
  airTime: number;
  spun: number; // radians turned in this air
  flipT: number; // seconds left in the current flick trick
  flipKind: Flick; // which one (for the view)
  tricks: Flick[]; // flick tricks finished in this air
  grind: number; // -1, or the rail being ground
  grindTime: number;
  grindKind: GrindKind;
  grindOff: number; // radians the board sits across the bar (boardslide), for the view
  balance: number; // -1..1 on a grind or a manual; at either end the rider falls off
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
  plateDown: boolean;
  bail: number; // seconds left on the floor
  score: number;
  last: { name: string; points: number } | null;
  prevJump: boolean;
  prevFlip: boolean;
  prevFlick: boolean;
};

export function start(x = 0, z = -20, yaw = 0, level: Level = plaza): State {
  return {
    t: 0, x, y: level.height(x, z), z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, roll: 0, speed: 0,
    air: false, airTime: 0, spun: 0, flipT: 0, flipKind: "kickflip", tricks: [], grind: -1, grindTime: 0,
    grindKind: "50-50", grindOff: 0, balance: 0, manual: 0, manualTime: 0, chain: 0, chainT: 0, combo: [], comboScore: 0, comboKind: null, fan: false, jetT: 0,
    firing: { rear: false, lift: false, spin: 0, roll: 0 }, plateDown: false,
    bail: 0, score: 0, last: null, prevJump: false, prevFlip: false, prevFlick: false,
  };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

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

/** Fall: wipe the chain, and get back up after `bail` seconds. */
function bail(s: State, name: string) {
  s.bail = 1.2;
  s.speed = 0; s.vx = s.vz = 0;
  s.flipT = 0; s.grind = -1; s.manual = 0; endChain(s);
  s.last = { name, points: 0 };
}

/** Run into something solid: lose most of the speed, and bail if it was fast and the thing was worth a name. */
function crash(s: State, name: string | null) {
  if (name && Math.abs(s.speed) > 6 * T) { bail(s, name); return s; }
  s.speed *= -0.2;
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

function land(s: State, h: number) {
  s.y = h; s.vy = 0; s.air = false; s.jetT = JETS.landBurst;
  const hs = Math.hypot(s.vx, s.vz);
  const off = Math.abs(wrap(Math.atan2(s.vx, s.vz) - s.yaw));
  if (s.flipT > 0) return bail(s, "Bail: still flipping");
  if (hs < 2) s.speed = s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw); // dropping back onto a wall: roll off it
  else if (off < 0.9) s.speed = hs;
  else if (off > Math.PI - 0.9) s.speed = -hs;
  else return bail(s, "Bail: landed sideways");
  if (s.airTime < 0.35) return;
  const turns = Math.round(Math.abs(s.spun) / Math.PI) * 180;
  const parts: string[] = [];
  if (turns >= 180) parts.push(String(turns));
  for (const t of new Set(s.tricks)) {
    const n = s.tricks.filter((x) => x === t).length;
    parts.push(n > 1 ? `${n}x ${t}` : t);
  }
  if (s.speed < 0) parts.push("fakie");
  const points = Math.round(s.airTime * 100 + (turns / 180) * 250 + s.tricks.reduce((n, t) => n + FLICK_POINTS[t], 0));
  award(s, parts.length ? parts.join(" ") : "Air", points, "air");
}

/** The floor's rise per metre in x and z, by central difference. */
function gradient(level: Level, x: number, z: number): [number, number] {
  const e = 0.25;
  return [(level.height(x + e, z) - level.height(x - e, z)) / (2 * e), (level.height(x, z + e) - level.height(x, z - e)) / (2 * e)];
}

/** One fixed step on `level` (the plaza unless told otherwise). Mutates and returns `s`. */
export function step(s: State, inp: Input, level: Level = plaza): State {
  const tune = TUNE;
  const pressed = inp.jump && !s.prevJump;
  const flipPressed = inp.flip && !s.prevFlip;
  const flick = inp.flick ?? (flipPressed ? "kickflip" : null);
  const flickPressed = flick !== null && (!inp.flick || !s.prevFlick);
  s.prevJump = inp.jump; s.prevFlip = inp.flip; s.prevFlick = inp.flick !== null;
  s.t += DT;
  s.firing = { rear: false, lift: false, spin: 0, roll: 0 };

  if (s.chainT > 0 && !s.air && s.grind < 0 && !s.manual && (s.chainT -= DT) <= 0) endChain(s); // the clock only runs on the ground, and a held manual keeps the chain alive
  if (s.bail > 0) {
    s.bail -= DT;
    s.plateDown = false;
    s.fan = false;
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
    s.speed *= 1 - (ledge ? 0.05 : 0.15) * DT;
    s.balance += (BALANCE_DRIFT * (ledge ? 0.5 : 1) * (s.balance + (s.balance >= 0 ? 0.15 : -0.15)) - BALANCE_PUSH * inp.steer) * DT;
    s.x += fx * s.speed * DT; s.z += fz * s.speed * DT;
    const t = onRail(r, s.x, s.z).t;
    s.y = railY(r, t);
    if (Math.abs(s.balance) >= 1) { s.y = level.height(s.x, s.z); bail(s, `Bail: fell off the ${ledge ? "ledge" : "rail"}`); return s; }
    s.firing.rear = s.speed > 1; // the jets hold the slide
    if (pressed || t < 0 || t > 1) {
      if (s.grindTime > 0.2) award(s, (ledge ? LEDGE_NAME : GRIND_NAME)[s.grindKind], Math.round(s.grindTime * GRIND_POINTS[s.grindKind]), "grind");
      s.grind = -1;
      s.vx = fx * s.speed; s.vz = fz * s.speed;
      s.vy = pressed ? OLLIE : 0;
      takeOff(s);
    }
    return s;
  }

  if (!s.air) {
    // a manual: balance on two wheels. It drifts toward tipping over; push or brake to hold it
    if (inp.manual && !s.manual && Math.abs(s.speed) > MANUAL_MIN) { s.manual = inp.manual; s.manualTime = 0; s.balance = 0; }
    if (s.manual) {
      s.manualTime += DT;
      s.speed *= 1 - 0.1 * DT;
      s.balance += (BALANCE_DRIFT * (s.balance + (s.balance >= 0 ? 0.15 : -0.15)) - BALANCE_PUSH * inp.throttle * s.manual) * DT;
      if (inp.manual !== s.manual || Math.abs(s.speed) < MANUAL_MIN) endManual(s);
      else if (Math.abs(s.balance) >= 1) { bail(s, `Bail: lost the ${s.manual > 0 ? "manual" : "nose manual"}`); return s; }
    }
    const push = s.fan ? tune.top * JETS.fanTop : tune.top; // what pushing alone reaches
    const top = s.fan ? push : BOOST_TOP; // the most a downhill or the jets can carry it to
    if (inp.throttle < 0 && s.speed > 0) s.speed += inp.throttle * tune.brake * DT;
    else if (inp.throttle > 0 ? s.speed < push : inp.throttle < 0) s.speed += inp.throttle * tune.accel * DT;
    if (boosting) s.speed += BOOST * DT;
    else if (s.speed > push) s.speed -= (s.speed - push) * tune.over * DT;
    if (!inp.throttle && !boosting) s.speed *= 1 - COAST * DT;
    s.speed = clamp(s.speed, -push * 0.5, top);
    const dir = Math.sign(s.speed || 1);
    const [gx, gz] = gradient(level, s.x, s.z);
    const along = gx * fx + gz * fz, across = gx * fz - gz * fx; // rise ahead, and to the right
    const pitched = Math.atan(along) - s.pitch;
    s.pitch = Math.atan(along); s.roll = Math.atan(across);
    // pumping: weight the board as the floor curves up under it and the curve gives back speed
    if (inp.boost) s.speed += dir * PUMP * Math.abs(s.speed) * Math.max(0, pitched * dir);
    { // the board carves: weight over the trucks, tighter when fast, and it falls toward downhill
      const load = Math.abs(s.speed) / tune.top;
      s.yaw += inp.steer * tune.turn * DT * Math.min(1, Math.abs(s.speed) / (3 * T)) * dir / (1 + CARVE * load);
      s.yaw -= DRIFT * across * DT * Math.min(1, Math.abs(s.speed) / (3 * T)) * dir;
      s.speed *= 1 - CARVE_DRAG * Math.abs(inp.steer) * load * DT;
    }
    s.firing.rear = boosting || (inp.throttle > 0 && s.speed < tune.top);

    const nx = s.x + Math.sin(s.yaw) * s.speed * DT, nz = s.z + Math.cos(s.yaw) * s.speed * DT;
    const dist = Math.abs(s.speed * DT);
    if (hitObstacle(level, nx, nz, s.y)) return crash(s, "Hit a tree");
    // walk the stride in 10 cm strides: a rise too sharp for its length is a wall (the side of a box),
    // a steep curve (a quarter pipe near its lip) is not
    const n = Math.max(1, Math.ceil(dist / 0.1));
    let prev = s.y;
    for (let i = 1; i <= n; i++) {
      const h = level.height(s.x + ((nx - s.x) * i) / n, s.z + ((nz - s.z) * i) / n);
      if (h - prev > Math.max(s.fan ? JETS.fanStep : STEP, (dist / n) * MAX_SLOPE)) { // the fan sucks it up a kerb or box side
        if (Math.abs(s.pitch) < WALL || s.pitch * dir < 0 || s.vy < 0.5 * Math.abs(s.speed)) return crash(s, null);
        // already climbing a curve and it goes vertical: leave the wall along its face, up past the coping
        const v = Math.abs(s.speed), c = Math.cos(s.pitch);
        s.vx = fx * v * c * dir; s.vz = fz * v * c * dir; s.vy = v * Math.sin(Math.abs(s.pitch));
        takeOff(s);
        return s;
      }
      prev = h;
    }
    const h = prev;
    s.speed -= G * Math.sin(s.pitch) * DT; // slopes slow you going up and speed you coming down, even from rest
    const vy = s.vy;
    s.vx = Math.sin(s.yaw) * s.speed; s.vz = Math.cos(s.yaw) * s.speed;
    s.x = nx; s.z = nz;
    if (h < s.y + vy * DT - 0.15 && !s.fan) { // the floor fell away: off a lip or an edge (the fan holds it down)
      takeOff(s);
      s.vy = vy;
    } else {
      s.vy = (h - s.y) / DT;
      s.y = h;
    }
    if (!s.air && pressed) { s.vy = OLLIE; s.jetT = JETS.pop; takeOff(s); }
  }

  if (s.air) {
    s.airTime += DT;
    s.vy -= (G + (s.fan ? JETS.fanPull : 0)) * DT;
    if (boosting) { s.vx += fx * BOOST * DT; s.vz += fz * BOOST * DT; s.firing.rear = true; }
    if (inp.steer) {
      const w = inp.steer * tune.airSpin * DT;
      s.yaw += w; s.spun += w;
      s.firing.spin = inp.steer > 0 ? 1 : -1;
    }
    if (flickPressed && flick && s.flipT <= 0) { s.flipT = FLICK_TIME; s.flipKind = flick; }
    if (s.flipT > 0) {
      if (s.flipKind === "shove-it") s.firing.spin = 1; // the nose jets turn it
      else { s.firing.lift = true; s.firing.roll = s.flipKind === "kickflip" ? 1 : -1; } // the corners fire unevenly
      s.flipT -= DT; if (s.flipT <= 0) { s.flipT = 0; s.tricks.push(s.flipKind); } }
    const hit = hitObstacle(level, s.x + s.vx * DT, s.z + s.vz * DT, s.y + s.vy * DT);
    if (hit) { s.vx = s.vz = 0; s.speed = 0; } // thrown against the trunk: drop down it
    s.x += s.vx * DT; s.y += s.vy * DT; s.z += s.vz * DT;

    if (s.vy < 0) { // dropping onto a rail starts a grind
      const i = level.rails.findIndex((r) => {
        const o = onRail(r, s.x, s.z);
        return o.off < 0.45 && o.t > 0 && o.t < 1 && Math.abs(s.y - railY(r, o.t)) < 0.25;
      });
      if (i >= 0 && s.flipT <= 0) {
        const r = level.rails[i], o = onRail(r, s.x, s.z);
        const dir = s.vx * o.dx + s.vz * o.dz >= 0 ? 1 : -1; // ride the way you came in
        // the approach angle names the grind: along the bar is a 50-50, across it a boardslide, between a nosegrind or 5-0
        const rel = wrap(s.yaw - Math.atan2(dir * o.dx, dir * o.dz));
        s.grindKind = grindKind(Math.abs(rel), Math.sign(rel) || 1);
        s.grindOff = s.grindKind === "boardslide" ? Math.PI / 2 : 0;
        s.balance = s.grindKind === "50-50" ? 0 : Math.sign(rel) * 0.3;
        s.grind = i; s.grindTime = 0;
        s.x = r.a.x + (r.b.x - r.a.x) * o.t; s.z = r.a.z + (r.b.z - r.a.z) * o.t;
        s.y = railY(r, o.t); s.vy = 0;
        s.speed = Math.max(3, Math.abs(s.vx * o.dx + s.vz * o.dz));
        s.yaw = Math.atan2(dir * o.dx, dir * o.dz);
        s.air = false;
        return s;
      }
    }
    const h = level.height(s.x, s.z);
    if (s.y <= h && s.vy <= 0) land(s, h);
  }

  const b = level.bounds;
  if (s.x < b.minX || s.x > b.maxX || s.z < b.minZ || s.z > b.maxZ) { // the wall
    s.x = clamp(s.x, b.minX, b.maxX); s.z = clamp(s.z, b.minZ, b.maxZ);
    s.speed *= -0.3; s.vx *= -0.3; s.vz *= -0.3;
  }
  return s;
}
