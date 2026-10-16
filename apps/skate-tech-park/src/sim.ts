// The ride as a pure fixed-step simulation: no three.js, no DOM, so the tests drive it headless
// and the page only draws what it says. One rider at a time, on a board or in the roadster.
//
// The roadster carries ten cold-gas thrusters fed by one air tank: four at the back (the main one
// behind the licence plate, which drops to uncover it), four under the corners for lift, and two at
// the nose for spinning in the air. The tank refills slowly while the car is on the ground.
import { clamp } from "@rustybuns/util";
import { hitObstacle, type Level, onRail, railY } from "./level.ts";
import { plaza } from "./levels/plaza.ts";

export const DT = 1 / 60;
const G = 20; // gamey gravity: snappier than 9.8

export type Mode = "skate" | "car";

export type Flick = "kickflip" | "heelflip" | "shove-it";

export type Input = {
  throttle: number; // -1..1
  steer: number; // -1..1, left is +
  jump: boolean; // board: ollie (on press). car: lift thrusters (held)
  boost: boolean; // car: rear thrusters. board: pump (held through a transition)
  flip: boolean; // board: kickflip (on press, in the air); shorthand for flick "kickflip"
  flick: Flick | null; // board: a flick trick, on press, in the air (the gesture layer resolves a drag or stick into this)
  fan: boolean; // car: the suction fan, held
};

export const IDLE: Input = { throttle: 0, steer: 0, jump: false, boost: false, flip: false, flick: null, fan: false };

const TUNE = {
  skate: { accel: 7, top: 10, turn: 2.6, airSpin: 7 },
  car: { accel: 20, top: 32, turn: 1.9, airSpin: 6 },
};
// The roadster's whole tuning block: thrusters, tank and the suction fan.
export const ROADSTER = {
  boost: 32, // m/s² from the rear thrusters
  boostTop: 48,
  lift: 34, // m/s² up from the four under the corners, more than gravity
  drain: { boost: 0.18, lift: 0.3, spin: 0.08, fan: 0.12 }, // tank per second
  refill: 0.06,
  fanTop: 0.6, // the fan holds it to this share of top speed
  fanPull: 26, // m/s² extra downward in the air with the fan on
  fanStep: 1.6, // metres: with the fan on, a kerb, box side or stair this low is driven up
};
const BOOST = ROADSTER.boost;
const BOOST_TOP = ROADSTER.boostTop;
const LIFT = ROADSTER.lift;
const DRAIN = ROADSTER.drain;
const REFILL = ROADSTER.refill;
const MAX_SLOPE = 3; // a rise steeper than this (about 72 degrees) in one stride is a wall, not a ramp
const CARVE = 0.8; // how much speed stiffens the board's turn: at top speed it turns 1/(1+CARVE) as tight
const CARVE_DRAG = 0.5; // a hard carve at speed scrubs this share of it per second
const DRIFT = 0.8; // rad/s the board falls toward downhill per unit of cross slope
const PUMP = 0.6; // board: speed gained per radian the ground curves up ahead, as a share of speed, while pumping
const WALL = 1; // radians: a rider this far up a curve who meets a sharper rise is on a wall, and flies off it
const STEP = 0.2; // a kerb or stair this low is always rideable

const FLICK_POINTS: Record<Flick, number> = { kickflip: 300, heelflip: 300, "shove-it": 200 };
const FLICK_TIME = 0.45;
const CHAIN_WINDOW = 3; // seconds on the ground between tricks before the chain ends
const CHAIN_MAX = 8;

export type GrindKind = "50-50" | "boardslide" | "nosegrind" | "5-0";
const GRIND_POINTS: Record<GrindKind, number> = { "50-50": 300, "5-0": 350, nosegrind: 400, boardslide: 450 };
const LEDGE_NAME: Record<GrindKind, string> = { "50-50": "50-50 slide", "5-0": "5-0 slide", nosegrind: "Nose slide", boardslide: "Boardslide" };
const GRIND_NAME: Record<GrindKind, string> = { "50-50": "50-50 grind", "5-0": "5-0 grind", nosegrind: "Nosegrind", boardslide: "Boardslide" };
const BALANCE_DRIFT = 1.1; // how fast a grind pulls off balance per unit of lean, per second
const BALANCE_PUSH = 3.2; // how hard steering pulls it back

/** What the approach to a rail makes of the grind: `off` is the angle between the rider and the bar, `side` +1 if coming in from its left. */
export function grindKind(off: number, side: number): GrindKind {
  const a = off > Math.PI / 2 ? Math.PI - off : off; // riding the bar backwards is the same trick
  if (a < 0.35) return "50-50";
  if (a > 1.1) return "boardslide";
  return side > 0 ? "nosegrind" : "5-0";
}

export type Firing = { rear: boolean; lift: boolean; spin: -1 | 0 | 1 };

export type State = {
  mode: Mode;
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
  balance: number; // -1..1 on a grind; at either end the rider falls off
  chain: number; // tricks landed in a row; the score multiplier
  chainT: number; // seconds left to extend it
  fan: boolean; // the suction fan is on
  tank: number; // 0..1
  firing: Firing;
  plateDown: boolean;
  bail: number; // seconds left on the floor
  score: number;
  last: { name: string; points: number } | null;
  prevJump: boolean;
  prevFlip: boolean;
  prevFlick: boolean;
};

export function start(mode: Mode, x = 0, z = -20, yaw = 0, level: Level = plaza): State {
  return {
    mode, t: 0, x, y: level.height(x, z), z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, roll: 0, speed: 0,
    air: false, airTime: 0, spun: 0, flipT: 0, flipKind: "kickflip", tricks: [], grind: -1, grindTime: 0,
    grindKind: "50-50", grindOff: 0, balance: 0, chain: 0, chainT: 0, fan: false,
    tank: 1, firing: { rear: false, lift: false, spin: 0 }, plateDown: false,
    bail: 0, score: 0, last: null, prevJump: false, prevFlip: false, prevFlick: false,
  };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Score a trick; each one landed within the window of the last is multiplied by how long the chain is. */
function award(s: State, name: string, points: number) {
  s.chain = s.chainT > 0 ? Math.min(CHAIN_MAX, s.chain + 1) : 1;
  s.chainT = CHAIN_WINDOW;
  const total = points * s.chain;
  s.last = { name: s.chain > 1 ? `${name} x${s.chain}` : name, points: total };
  s.score += total;
}

/** Fall: wipe the chain, and get back up after `bail` seconds. */
function bail(s: State, name: string) {
  s.bail = s.mode === "car" ? 0.8 : 1.2;
  s.speed = 0; s.vx = s.vz = 0;
  s.flipT = 0; s.grind = -1; s.chain = 0; s.chainT = 0;
  s.last = { name, points: 0 };
}

/** Run into something solid: lose most of the speed, and bail if it was fast and the thing was worth a name. */
function crash(s: State, name: string | null) {
  if (name && Math.abs(s.speed) > 6) { bail(s, name); return s; }
  s.speed *= -0.2;
  return s;
}

function takeOff(s: State) {
  s.air = true;
  s.airTime = 0; s.spun = 0; s.tricks = [];
}

function land(s: State, h: number) {
  s.y = h; s.vy = 0; s.air = false;
  const hs = Math.hypot(s.vx, s.vz);
  const off = Math.abs(wrap(Math.atan2(s.vx, s.vz) - s.yaw));
  if (s.flipT > 0) return bail(s, "Bail: still flipping");
  if (hs < 2) s.speed = s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw); // dropping back onto a wall: roll off it
  else if (off < 0.9) s.speed = hs;
  else if (off > Math.PI - 0.9) s.speed = -hs;
  else return bail(s, s.mode === "car" ? "Spun out" : "Bail: landed sideways");
  if (s.airTime < 0.35) return;
  const turns = Math.round(Math.abs(s.spun) / Math.PI) * 180;
  const parts: string[] = [];
  if (turns >= 180) parts.push(String(turns));
  for (const t of new Set(s.tricks)) {
    const n = s.tricks.filter((x) => x === t).length;
    parts.push(n > 1 ? `${n}x ${t}` : t);
  }
  if (s.speed < 0) parts.push(s.mode === "car" ? "reverse" : "fakie");
  const points = Math.round(s.airTime * 100 + (turns / 180) * 250 + s.tricks.reduce((n, t) => n + FLICK_POINTS[t], 0));
  award(s, parts.length ? parts.join(" ") : "Air", points);
}

/** The floor's rise per metre in x and z, by central difference. */
function gradient(level: Level, x: number, z: number): [number, number] {
  const e = 0.25;
  return [(level.height(x + e, z) - level.height(x - e, z)) / (2 * e), (level.height(x, z + e) - level.height(x, z - e)) / (2 * e)];
}

/** One fixed step on `level` (the plaza unless told otherwise). Mutates and returns `s`. */
export function step(s: State, inp: Input, level: Level = plaza): State {
  const tune = TUNE[s.mode];
  const car = s.mode === "car";
  const pressed = inp.jump && !s.prevJump;
  const flipPressed = inp.flip && !s.prevFlip;
  const flick = inp.flick ?? (flipPressed ? "kickflip" : null);
  const flickPressed = flick !== null && (!inp.flick || !s.prevFlick);
  s.prevJump = inp.jump; s.prevFlip = inp.flip; s.prevFlick = inp.flick !== null;
  s.t += DT;
  s.firing = { rear: false, lift: false, spin: 0 };

  if (s.chainT > 0 && !s.air && s.grind < 0 && (s.chainT -= DT) <= 0) s.chain = 0; // the clock only runs on the ground
  if (s.bail > 0) {
    s.bail -= DT;
    s.plateDown = false;
    s.fan = false;
    if (car && !s.air) s.tank = Math.min(1, s.tank + REFILL * DT);
    return s;
  }

  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  const thrust = (kind: keyof typeof DRAIN) => {
    if (!car || s.tank <= 0) return false;
    s.tank = Math.max(0, s.tank - DRAIN[kind] * DT);
    return true;
  };
  const boosting = inp.boost && thrust("boost");
  s.firing.rear = boosting;
  s.plateDown = boosting || (s.plateDown && inp.boost);
  s.fan = car && inp.fan && thrust("fan");

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
    if (pressed || t < 0 || t > 1) {
      if (s.grindTime > 0.2) award(s, (ledge ? LEDGE_NAME : GRIND_NAME)[s.grindKind], Math.round(s.grindTime * GRIND_POINTS[s.grindKind]));
      s.grind = -1;
      s.vx = fx * s.speed; s.vz = fz * s.speed;
      s.vy = pressed ? 7 : 0;
      takeOff(s);
    }
    return s;
  }

  if (!s.air) {
    const top = s.fan ? tune.top * ROADSTER.fanTop : boosting ? BOOST_TOP : !car && inp.boost ? tune.top * 1.5 : tune.top; // pumping can carry a board past its pushing speed
    s.speed += inp.throttle * tune.accel * DT + (boosting ? BOOST * DT : 0);
    if (!inp.throttle && !boosting) s.speed *= 1 - 0.6 * DT;
    s.speed = clamp(s.speed, -top * 0.5, top);
    const dir = Math.sign(s.speed || 1);
    const [gx, gz] = gradient(level, s.x, s.z);
    const along = gx * fx + gz * fz, across = gx * fz - gz * fx; // rise ahead, and to the right
    const pitched = Math.atan(along) - s.pitch;
    s.pitch = Math.atan(along); s.roll = Math.atan(across);
    // pumping: weight the board as the floor curves up under it and the curve gives back speed
    if (!car && inp.boost) s.speed += dir * PUMP * Math.abs(s.speed) * Math.max(0, pitched * dir);
    if (car) s.yaw += inp.steer * tune.turn * DT * Math.min(1, Math.abs(s.speed) / 3) * dir;
    else { // a board carves: weight over the trucks, tighter when slow, and it falls toward downhill
      const load = Math.abs(s.speed) / tune.top;
      s.yaw += inp.steer * tune.turn * DT * Math.min(1, Math.abs(s.speed) / 3) * dir / (1 + CARVE * load);
      s.yaw -= DRIFT * across * DT * Math.min(1, Math.abs(s.speed) / 3) * dir;
      s.speed *= 1 - CARVE_DRAG * Math.abs(inp.steer) * load * DT;
    }

    const nx = s.x + Math.sin(s.yaw) * s.speed * DT, nz = s.z + Math.cos(s.yaw) * s.speed * DT;
    const dist = Math.abs(s.speed * DT);
    if (hitObstacle(level, nx, nz, s.y)) return crash(s, "Hit a tree");
    // walk the stride in 10 cm strides: a rise too sharp for its length is a wall (the side of a box),
    // a steep curve (a quarter pipe near its lip) is not
    const n = Math.max(1, Math.ceil(dist / 0.1));
    let prev = s.y;
    for (let i = 1; i <= n; i++) {
      const h = level.height(s.x + ((nx - s.x) * i) / n, s.z + ((nz - s.z) * i) / n);
      if (h - prev > Math.max(s.fan ? ROADSTER.fanStep : STEP, (dist / n) * MAX_SLOPE)) { // the fan sucks it up a kerb or box side
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
    if (dist > 1e-6) { // slopes slow you going up and speed you coming down
      s.speed -= G * Math.sin(s.pitch) * DT;
    }
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
    if (!s.air && pressed && !car) { s.vy = 7; takeOff(s); }
    if (!s.air && inp.jump && car && s.tank > 0 && !s.fan) { s.vy = Math.max(s.vy, 2); takeOff(s); }
    if (!s.air && car && !boosting && !s.fan) s.tank = Math.min(1, s.tank + REFILL * DT);
  }

  if (s.air) {
    s.airTime += DT;
    s.vy -= (G + (s.fan ? ROADSTER.fanPull : 0)) * DT;
    if (car && inp.jump && thrust("lift")) { s.vy += LIFT * DT; s.firing.lift = true; }
    if (boosting) { s.vx += fx * BOOST * DT; s.vz += fz * BOOST * DT; }
    if (inp.steer && (!car || thrust("spin"))) {
      const w = inp.steer * tune.airSpin * DT;
      s.yaw += w; s.spun += w;
      if (car) s.firing.spin = inp.steer > 0 ? 1 : -1;
    }
    if (!car && flickPressed && flick && s.flipT <= 0) { s.flipT = FLICK_TIME; s.flipKind = flick; }
    if (s.flipT > 0) { s.flipT -= DT; if (s.flipT <= 0) { s.flipT = 0; s.tricks.push(s.flipKind); } }
    const hit = hitObstacle(level, s.x + s.vx * DT, s.z + s.vz * DT, s.y + s.vy * DT);
    if (hit) { s.vx = s.vz = 0; s.speed = 0; } // thrown against the trunk: drop down it
    s.x += s.vx * DT; s.y += s.vy * DT; s.z += s.vz * DT;

    if (!car && s.vy < 0) { // dropping onto a rail starts a grind
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
