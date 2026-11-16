// The load-in as plain data and one `step`, no DOM: you walk a level in first person, pick up one piece of gear at a time,
// carry it (the heavier it is, the slower you go) and set it down on the floor or on top of another piece. The page
// (main.ts) draws this and feeds it input; the harness and the tests drive the same functions.
import { clamp } from "@rustybuns/util";
import { gear } from "@rustybuns/gear";

/** Metres per second, empty-handed and standing. */
export const WALK = 1.5;
/** The most one person lifts; anything heavier needs a second pair of hands or wheels. */
export const MAX_LIFT = 50;
/** How far from an item's centre your hands reach, in metres. */
export const REACH = 1.6;
export const EYE = 1.65, EYE_CROUCH = 1.0, RADIUS = 0.25;
const SNAP = Math.PI / 12;

/** A piece of gear on the floor: its own key and its id in @rustybuns/gear, where its size, weight and jacks come from. */
export interface Item { key: string; gear: string; x: number; y: number; z: number; rot: number }
export interface Level {
  name: string;
  /** Where you can walk: x and z bounds in metres (the garage floor and the driveway). */
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** The room you see: walls stand on these edges, with the door open on the +z side. */
  room: { x0: number; x1: number; z0: number; z1: number; height: number; door: number };
  /** Fixed things you plug into, not carried. */
  outlets: { key: string; x: number; y: number; z: number }[];
  /** Where people walk: a cable lying across one with no ramp over it is a trip hazard. */
  walkways?: { name: string; x0: number; x1: number; z0: number; z1: number }[];
  start: { x: number; z: number; yaw: number };
  items: Item[];
}

export interface Input { forward: number; right: number; turn: number; crouch: boolean }
export interface World {
  level: Level;
  t: number;
  you: { x: number; z: number; yaw: number; pitch: number; crouch: boolean; speed: number };
  items: Item[];
  /** What is in your hands: an item's key, and its turn relative to where you face. */
  held: { key: string; rel: number } | null;
}

/** The garage: an amp head by the back-wall outlet, the 4x12 cab out on the driveway, a guitar in the corner, a powered
 * speaker across the way in, and a road case of cables and a cable ramp by the left wall. */
export const GARAGE: Level = {
  name: "garage",
  bounds: { x0: -2.75, x1: 2.75, z0: 0.25, z1: 9.75 },
  room: { x0: -3, x1: 3, z0: 0, z1: 7, height: 2.6, door: 4.8 },
  outlets: [{ key: "outlet", x: -2.2, y: 0.3, z: 0.01 }],
  walkways: [{ name: "the way in", x0: -0.4, x1: 0.4, z0: 0.4, z1: 9.75 }],
  start: { x: -0.6, z: 9.5, yaw: 0 },
  items: [
    { key: "amp-head", gear: "amp-head", x: -1.4, y: 0, z: 0.45, rot: 0 },
    { key: "cab-4x12", gear: "cab-4x12", x: 0.9, y: 0, z: 7.9, rot: 0 },
    { key: "guitar", gear: "guitar", x: 2.5, y: 0, z: 1.2, rot: -Math.PI / 2 },
    { key: "top", gear: "top-12-powered", x: 2.0, y: 0, z: 2.6, rot: 0 },
    { key: "case", gear: "road-case-m", x: -2.3, y: 0, z: 3.2, rot: Math.PI / 2 },
    { key: "ramp", gear: "cable-ramp-2ch", x: -2.1, y: 0, z: 5.2, rot: 0 },
  ],
};

export function newWorld(level: Level = GARAGE): World {
  return {
    level, t: 0,
    you: { x: level.start.x, z: level.start.z, yaw: level.start.yaw, pitch: 0, crouch: false, speed: 0 },
    items: level.items.map((i) => ({ ...i })),
    held: null,
  };
}

const gearOf = (i: Item) => gear(i.gear);
/** Width, height and depth in metres. */
export const dims = (i: Item): [number, number, number] => { const s = gearOf(i).size; return [s.w, s.h, s.d]; };
/** Gear this low (a cable ramp) is walked over, not round. */
export const LOW = 0.1;
/** Where you face on the floor: yaw 0 looks down -z, as a three.js camera does. */
export const facing = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
export const heldItem = (w: World) => (w.held ? w.items.find((i) => i.key === w.held!.key) ?? null : null);

/** How fast you walk carrying `kg`: a 45 kg sub is a slow shuffle, a guitar barely counts. */
export const carrySpeed = (kg: number, crouch = false) => WALK * clamp(1 - kg / 55, 0.2, 1) * (crouch ? 0.5 : 1);

/** A box's footprint as its four corners on the floor. */
function corners(x: number, z: number, rot: number, w: number, d: number): [number, number][] {
  const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => [x + a * c + b * s, z - a * s + b * c]);
}
/** Whether two footprints overlap (separating axes, two boxes on the floor). */
function overlap(a: [number, number][], b: [number, number][]): boolean {
  for (const poly of [a, b]) for (let i = 0; i < 2; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[i + 1], nx = z1 - z0, nz = x0 - x1;
    const pa = a.map(([x, z]) => x * nx + z * nz), pb = b.map(([x, z]) => x * nx + z * nz);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
  }
  return true;
}
const footprint = (i: Item, x = i.x, z = i.z, rot = i.rot) => corners(x, z, rot, dims(i)[0], dims(i)[2]);

/** Where the held item sits now: in front of you, low if it's heavy, turned as you turned it. */
export function holdPose(w: World): { x: number; y: number; z: number; rot: number } | null {
  const i = heldItem(w);
  if (!i || !w.held) return null;
  const [, h, d] = dims(i), f = facing(w.you.yaw), out = 0.3 + d / 2;
  const top = w.you.crouch ? 0.75 : 1.1;
  return { x: w.you.x + f.x * out, y: Math.max(0.1, top - h), z: w.you.z + f.z * out, rot: w.you.yaw + w.held.rel };
}

/** Push you out of the walls and the gear on the floor. */
function collide(w: World) {
  const { bounds: b } = w.level, you = w.you;
  for (const i of w.items) {
    if (i.key === w.held?.key || dims(i)[1] < LOW) continue;
    const [sw, , sd] = dims(i), c = Math.cos(i.rot), s = Math.sin(i.rot);
    const dx = you.x - i.x, dz = you.z - i.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const px = clamp(lx, -sw / 2, sw / 2), pz = clamp(lz, -sd / 2, sd / 2);
    const ex = lx - px, ez = lz - pz, m = Math.hypot(ex, ez);
    if (m >= RADIUS) continue;
    // Inside the box: out the nearest face. Touching an edge: straight back out to the radius.
    const [nx, nz] = m > 1e-6 ? [ex / m, ez / m] : sw / 2 - Math.abs(lx) < sd / 2 - Math.abs(lz) ? [Math.sign(lx) || 1, 0] : [0, Math.sign(lz) || 1];
    const tx = px + nx * RADIUS, tz = pz + nz * RADIUS;
    you.x = i.x + tx * c + tz * s;
    you.z = i.z - tx * s + tz * c;
  }
  you.x = clamp(you.x, b.x0, b.x1);
  you.z = clamp(you.z, b.z0, b.z1);
}

/** One tick: walk and turn by the input, at the pace of what you carry. */
export function step(w: World, dt: number, input: Input) {
  const you = w.you, i = heldItem(w);
  you.crouch = input.crouch;
  you.yaw += input.turn;
  you.speed = carrySpeed(i ? gearOf(i).kg : 0, you.crouch);
  const f = facing(you.yaw), len = Math.hypot(input.forward, input.right);
  if (len > 0) {
    const k = (you.speed * dt) / Math.max(1, len);
    you.x += (f.x * input.forward - f.z * input.right) * k;
    you.z += (f.z * input.forward + f.x * input.right) * k;
  }
  collide(w);
  w.t += dt;
}

/** The item you'd pick up now: the nearest one in reach, roughly where you look. */
export function aimed(w: World): Item | null {
  const f = facing(w.you.yaw);
  let best: Item | null = null, bestD = Infinity;
  for (const i of w.items) {
    if (i.key === w.held?.key) continue;
    const dx = i.x - w.you.x, dz = i.z - w.you.z, d = Math.hypot(dx, dz);
    if (d > REACH || (d > 0.3 && (dx * f.x + dz * f.z) / d < 0.7)) continue;
    if (d < bestD) best = i, bestD = d;
  }
  return best;
}

export type Answer = { ok: true } | { ok: false; why: string };

/** Pick up `key`: in reach, hands free, light enough for one person, and nothing stacked on it. */
export function pickUp(w: World, key: string): Answer {
  const i = w.items.find((x) => x.key === key);
  if (!i) return { ok: false, why: `no ${key} here` };
  if (w.held) return { ok: false, why: "your hands are full" };
  const g = gearOf(i);
  if (Math.hypot(i.x - w.you.x, i.z - w.you.z) > REACH) return { ok: false, why: `${g.what} is out of reach` };
  if (g.kg > MAX_LIFT) return { ok: false, why: `${g.what} is ${g.kg} kg, too heavy to lift alone` };
  const fp = footprint(i), top = i.y + dims(i)[1];
  if (w.items.some((o) => o !== i && Math.abs(o.y - top) < 0.01 && overlap(fp, footprint(o)))) return { ok: false, why: `something is on the ${g.what}` };
  w.held = { key, rel: i.rot - w.you.yaw };
  return { ok: true };
}

/** Turn what you hold by a step (Q and E): -1 left, 1 right. */
export function turnHeld(w: World, dir: number) {
  if (w.held) w.held.rel -= dir * SNAP;
}

/** Set it down where it is held, square to a 15 degree step, on the floor or on top of whatever is under it. */
export function putDown(w: World): Answer {
  const i = heldItem(w), p = holdPose(w);
  if (!i || !p) return { ok: false, why: "your hands are empty" };
  const [sw, , sd] = dims(i), r = w.level.room, half = Math.max(sw, sd) / 2;
  const rot = Math.round(p.rot / SNAP) * SNAP;
  const x = clamp(p.x, r.x0 + half, r.x1 - half), z = clamp(p.z, r.z0 + half, w.level.bounds.z1 + RADIUS - half);
  const fp = corners(x, z, rot, sw, sd);
  let y = 0;
  for (const o of w.items) if (o !== i && overlap(fp, footprint(o))) y = Math.max(y, o.y + dims(o)[1]);
  Object.assign(i, { x, y, z, rot });
  w.held = null;
  collide(w);
  return { ok: true };
}

/** Walk straight to (x, z) at your carrying pace, tick by tick; the seconds it took. Stops at a wall or after `limit` s.
 * `tick` runs after each step (the cables drag behind you). */
export function walkTo(w: World, x: number, z: number, limit = 120, tick?: (dt: number) => void): number {
  const t0 = w.t, dt = 1 / 60;
  let lastD = Infinity, stuck = 0;
  while (w.t - t0 < limit) {
    const dx = x - w.you.x, dz = z - w.you.z, d = Math.hypot(dx, dz);
    if (d < 0.02) break;
    if (d > lastD - 1e-4 && ++stuck > 30) break;
    lastD = d;
    w.you.yaw = Math.atan2(-dx, -dz);
    step(w, dt, { forward: Math.min(1, d / (w.you.speed * dt || 1)), right: 0, turn: 0, crouch: w.you.crouch });
    tick?.(dt);
  }
  return w.t - t0;
}

const cm = (v: number) => Math.round(v * 100) / 100;
const deg = (r: number) => ((Math.round((r * 180) / Math.PI) % 360) + 360) % 360;

/** What a test or an agent reads: you, what you hold, and where every piece of gear is. */
export function snapshot(w: World) {
  const at = aimed(w);
  return {
    level: w.level.name, t: cm(w.t),
    you: { x: cm(w.you.x), z: cm(w.you.z), yaw: deg(w.you.yaw), crouch: w.you.crouch, speed: cm(w.you.speed) },
    holding: w.held?.key ?? null,
    aimed: at?.key ?? null,
    items: w.items.map((i) => {
      const p = i.key === w.held?.key ? holdPose(w)! : i;
      return { key: i.key, gear: i.gear, kg: gearOf(i).kg, x: cm(p.x), y: cm(p.y), z: cm(p.z), rot: deg(p.rot), held: i.key === w.held?.key };
    }),
  };
}
