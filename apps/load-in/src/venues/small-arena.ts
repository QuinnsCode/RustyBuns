// The small arena: the first room where the speakers hang. Four rigging points in the roof steel, each with a motor:
// two for the main line arrays either side of the stage and two for the out-fills that turn to the side seats. You
// carry the boxes from the dock to under a point and hang them one at a time on its frame, set the splay pins from the
// calculator, and check the point's load against its limit before anyone runs the motor, standing clear while it
// flies. Front fills sit on the stage lip for the front rows the arrays shoot over, and the desk goes out at front of
// house. The score is the coverage over the whole bowl: the floor, the front rows, the side seats and the end seats,
// each at its own height on the rake. Plain data, no DOM; the page (small-arena-view.ts) draws it.
import { clamp } from "@rustybuns/util";
import { type Source, type Vec3, MAX_SPLAY_DEG, arrayPoses, gear as catalog, levelAt, splayCalc } from "@rustybuns/gear";
import { REACH, type Answer, type Item, type Level, type World } from "../sim.ts";
import { doors, showScore } from "../clock.ts";
import { type Zone, mean, rig, sources as placed } from "./dive-bar.ts";

export const BOX = "line-array-10";
const BOX_H = catalog(BOX).size.h, BOX_KG = catalog(BOX).kg;
/** The flying frame on each motor's hook, and the motor's chain and hook hanging off the point, kg. */
export const FRAME_KG = 28, MOTOR_KG = 30;
/** The roof steel's height, and the highest the frame goes under its motor. */
export const STEEL_Y = 14, MAX_TRIM = 12;
/** Chain motors climb about 4 m a minute. */
export const MOTOR_SPEED = 4 / 60;
/** Nobody stands closer than this to a point while its motor runs. */
export const CLEAR = 2.5;
/** The most boxes a frame takes. */
export const MAX_BOXES = 12;

/** A rigging point: where it is, which way the hang faces, what the steel there is rated for, and the seats it covers. */
export type Point = { key: string; name: string; x: number; z: number; yaw: number; limitKg: number; plan: number; far: Vec3; near: Vec3 };

// The stage is at the dock end (+z), the arrays face down the room (-z), the floor runs out to the end seats.
const SIDE = Math.atan2(5, -12);
export const POINTS: readonly Point[] = [
  { key: "main-l", name: "main left", x: -7, z: 31, yaw: Math.PI, limitKg: 350, plan: 10, far: { x: -4, y: 6.1, z: -0.5 }, near: { x: -6, y: 1.6, z: 25 } },
  { key: "main-r", name: "main right", x: 7, z: 31, yaw: Math.PI, limitKg: 350, plan: 10, far: { x: 4, y: 6.1, z: -0.5 }, near: { x: 6, y: 1.6, z: 25 } },
  { key: "out-l", name: "out-fill left", x: -8.5, z: 29.5, yaw: -SIDE, limitKg: 170, plan: 9, far: { x: -16.5, y: 5, z: 12 }, near: { x: -10.5, y: 1.5, z: 24 } },
  { key: "out-r", name: "out-fill right", x: 8.5, z: 29.5, yaw: SIDE, limitKg: 170, plan: 9, far: { x: 16.5, y: 5, z: 12 }, near: { x: 10.5, y: 1.5, z: 24 } },
];
export const point = (key: string) => POINTS.find((p) => p.key === key) ?? null;

const stack = (prefix: string, n: number, x: number, z: number, from = 0): Item[] =>
  Array.from({ length: n }, (_, k) => ({ key: `${prefix}-${from + k + 1}`, gear: BOX, x, y: k * BOX_H, z, rot: 0 }));

export const SMALL_ARENA: Level = {
  name: "small-arena",
  bounds: { x0: -8.75, x1: 8.75, z0: 9.25, z1: 39.5 },
  room: { x0: -18, x1: 18, z0: -2, z1: 37, height: 15, door: 8 },
  outlets: [],
  start: { x: 0, z: 38.8, yaw: 0 },
  // Off the truck at the dock: four stacks of main boxes, two of out-fill boxes, the fills, and the desk on its case.
  items: [
    ...stack("main", 4, -4.5, 35.5), ...stack("main", 4, -3.5, 35.5, 4),
    ...stack("main", 4, 3.5, 35.5, 8), ...stack("main", 4, 4.5, 35.5, 12),
    ...stack("out", 3, -6.5, 36.2), ...stack("out", 3, 6.5, 36.2, 3),
    ...[-1.5, -0.5, 0.5, 1.5].map((x, k) => ({ key: `fill-${k + 1}`, gear: "fill-8-powered", x, y: 0, z: 34.6, rot: 0 })),
    { key: "case", gear: "road-case-m", x: 0, y: 0, z: 36.4, rot: 0 },
    { key: "desk", gear: "mixer-small", x: 0, y: 0.5, z: 36.4, rot: 0 },
  ],
};

/** The seats and the floor, each at its own ear height on the rake, and the stage and front of house. */
export const ZONES = {
  stage: { x0: -8, x1: 8, z0: 30, z1: 37 },
  front: { x0: -6, x1: 6, z0: 26, z1: 29.5 },
  floor: { x0: -9, x1: 9, z0: 10, z1: 26 },
  "side-l": { x0: -17, x1: -10, z0: 8, z1: 29 },
  "side-r": { x0: 10, x1: 17, z0: 8, z1: 29 },
  end: { x0: -17, x1: 17, z0: -1, z1: 8 },
  foh: { x0: -1.5, x1: 1.5, z0: 15, z1: 18 },
} satisfies Record<string, Zone>;

/** Ear height at a seat: standing on the floor, seated up the rake (half a metre a row) on the sides and the end. */
export function earAt(x: number, z: number): number {
  if (Math.abs(x) >= 10) return 1.2 + 0.55 * (Math.abs(x) - 10);
  if (z < 8) return 1.2 + 0.55 * (8 - z);
  return 1.6;
}

/** Mids and highs at the seats, dB SPL. */
export const TARGET = 100;
/** Within this many dB of the target counts. */
export const WINDOW = 4;
export const PASS = 85;
/** What each part of the room is worth, out of 100. */
export const WEIGHTS = { floor: 40, end: 20, sides: 25, front: 15 } as const;
type Part = keyof typeof WEIGHTS;
const PARTS: Record<Part, Zone[]> = { floor: [ZONES.floor], end: [ZONES.end], sides: [ZONES["side-l"], ZONES["side-r"]], front: [ZONES.front] };

/** A hang: its boxes top first, the top box's angle and the pins below it (degrees), the frame's height when flown, and
 * the trim it is planned to fly at (what the calculator figures for). */
export type Hang = { boxes: string[]; tilt: number; splays: number[]; trim: number | null; plan: number; checked: boolean };
const hangs = new WeakMap<World, Record<string, Hang>>();
export function hangsOf(w: World): Record<string, Hang> {
  let h = hangs.get(w);
  if (!h) hangs.set(w, (h = Object.fromEntries(POINTS.map((p) => [p.key, { boxes: [], tilt: 0, splays: [], trim: null, plan: p.plan, checked: false }]))));
  return h;
}

/** What hangs off a point: the boxes, the frame and the motor's chain. */
export const loadKg = (h: Hang) => h.boxes.length * BOX_KG + FRAME_KG + MOTOR_KG;
/** The frame's height on the deck: low enough to pin the next box under the bottom one. */
const lowTrim = (h: Hang) => 0.4 + h.boxes.length * BOX_H;
/** Where the frame is now: at its trim, or on the deck. */
export const frameY = (h: Hang) => h.trim ?? lowTrim(h);
const rad = (d: number) => (d * Math.PI) / 180;

/** Put every box of a hang where it hangs, and its angle in the rig, so the sound and the page see it. */
function pose(w: World, p: Point) {
  const h = hangsOf(w)[p.key], top = { x: p.x, y: frameY(h), z: p.z };
  const poses = arrayPoses(top, p.yaw, rad(h.tilt), h.splays.map(rad), h.boxes.length, BOX_H);
  h.boxes.forEach((key, k) => {
    const i = w.items.find((o) => o.key === key)!, b = poses[k];
    Object.assign(i, { x: b.centre.x, y: b.centre.y - BOX_H / 2, z: b.centre.z, rot: p.yaw, hung: true });
    rig(w).tilt[key] = b.pitch;
  });
}

/** The point you stand under, if any: within reach of it on the floor. */
export function under(w: World, within = REACH): Point | null {
  let best: Point | null = null, bd = within;
  for (const p of POINTS) { const d = Math.hypot(p.x - w.you.x, p.z - w.you.z); if (d <= bd) best = p, bd = d; }
  return best;
}

function at(w: World, key: string): { p: Point; h: Hang } | string {
  const p = point(key);
  if (!p) return `no rigging point ${key}`;
  if (Math.hypot(p.x - w.you.x, p.z - w.you.z) > REACH) return `walk under the ${p.name} point`;
  return { p, h: hangsOf(w)[key] };
}

/** Pin the box in your hands under the bottom of a hang on the deck. */
export function hang(w: World, key: string): Answer {
  const a = at(w, key);
  if (typeof a === "string") return { ok: false, why: a };
  const box = w.held && w.items.find((i) => i.key === w.held!.key);
  if (!box || box.gear !== BOX) return { ok: false, why: "hold a line array box to hang it" };
  if (a.h.trim !== null) return { ok: false, why: `the ${a.p.name} hang is in the air: bring it down first` };
  if (a.h.boxes.length >= MAX_BOXES) return { ok: false, why: `the frame takes ${MAX_BOXES} boxes` };
  w.held = null;
  if (a.h.boxes.length) a.h.splays.push(0);
  a.h.boxes.push(box.key);
  a.h.checked = false;
  pose(w, a.p);
  return { ok: true };
}

/** Take the bottom box off a hang on the deck, into your hands. */
export function unhang(w: World, key: string): Answer {
  const a = at(w, key);
  if (typeof a === "string") return { ok: false, why: a };
  if (w.held) return { ok: false, why: "your hands are full" };
  if (a.h.trim !== null) return { ok: false, why: `the ${a.p.name} hang is in the air: bring it down first` };
  const last = a.h.boxes.pop();
  if (!last) return { ok: false, why: `nothing hangs on the ${a.p.name} frame` };
  a.h.splays.pop();
  a.h.checked = false;
  const i = w.items.find((o) => o.key === last)!;
  delete i.hung;
  delete rig(w).tilt[last];
  w.held = { key: last, rel: 0 };
  pose(w, a.p);
  return { ok: true };
}

/** Set the top box's angle and the pins between boxes (degrees, whole ones; pins go 0 to 10). Only on the deck. */
export function pin(w: World, key: string, tilt: number, splays: readonly number[]): Answer {
  const a = at(w, key);
  if (typeof a === "string") return { ok: false, why: a };
  if (a.h.trim !== null) return { ok: false, why: `the pins are set on the deck: bring the ${a.p.name} hang down` };
  a.h.tilt = Math.round(clamp(tilt, -20, 10));
  a.h.splays = a.h.boxes.slice(1).map((_, k) => Math.round(clamp(splays[k] ?? 0, 0, MAX_SPLAY_DEG)));
  a.h.checked = false;
  pose(w, a.p);
  return { ok: true };
}

/** The splay calculator for a point: the angles for the boxes on it now, flown with its frame at `trim` metres. */
export function calc(w: World, key: string, trim?: number) {
  const p = point(key);
  if (!p) return null;
  const h = hangsOf(w)[key], n = h.boxes.length;
  trim ??= h.plan;
  return { trim, boxes: n, ...splayCalc({ x: p.x, y: trim, z: p.z }, p.yaw, n, BOX_H, p.far, p.near) };
}

/** Plan the trim a hang will fly at, metres (the calculator figures for it). */
export function plan(w: World, key: string, trim: number) {
  const h = point(key) && hangsOf(w)[key];
  if (h) h.plan = clamp(Math.round(trim * 2) / 2, 3, MAX_TRIM);
}

/** The rigger's check: walk under the point and add up what hangs on it against what its steel takes. */
export function check(w: World, key: string): Answer & { kg?: number; limit?: number } {
  const a = at(w, key);
  if (typeof a === "string") return { ok: false, why: a };
  const kg = loadKg(a.h), limit = a.p.limitKg;
  a.h.checked = kg <= limit;
  return a.h.checked ? { ok: true, kg, limit } : { ok: false, why: `${kg} kg on a ${limit} kg point: take boxes off`, kg, limit };
}

/** Run a point's motor until its frame is at `trim` metres (the motor's pace adds to the clock). Down is `land`. */
export function fly(w: World, key: string, trim: number): Answer {
  const p = point(key);
  if (!p) return { ok: false, why: `no rigging point ${key}` };
  const h = hangsOf(w)[key];
  if (!h.boxes.length) return { ok: false, why: `nothing hangs on the ${p.name} frame` };
  if (!h.checked) return { ok: false, why: `check the ${p.name} point before it flies` };
  if (Math.hypot(p.x - w.you.x, p.z - w.you.z) < CLEAR) return { ok: false, why: `stand clear: you're under the ${p.name} hang` };
  const to = clamp(trim, lowTrim(h) + 0.5, MAX_TRIM);
  w.t += Math.abs(to - (h.trim ?? lowTrim(h))) / MOTOR_SPEED;
  h.trim = to;
  pose(w, p);
  return { ok: true };
}

/** Bring a hang down to the deck: the same motor, the same rule about standing under it. */
export function land(w: World, key: string): Answer {
  const p = point(key);
  if (!p) return { ok: false, why: `no rigging point ${key}` };
  const h = hangsOf(w)[key];
  if (h.trim === null) return { ok: true };
  if (Math.hypot(p.x - w.you.x, p.z - w.you.z) < CLEAR) return { ok: false, why: `stand clear: you're under the ${p.name} hang` };
  w.t += Math.abs(h.trim - lowTrim(h)) / MOTOR_SPEED;
  h.trim = null;
  pose(w, p);
  return { ok: true };
}

/** What plays: a box once its hang is in the air, and every other speaker set down. */
export function playing(w: World, i: Item): boolean {
  if (i.gear !== BOX) return true;
  return POINTS.some((p) => { const h = hangsOf(w)[p.key]; return h.trim !== null && h.boxes.includes(i.key); });
}
export const sources = (w: World): Source[] => placed(w, (i) => playing(w, i));

/** One seat (or a square metre of floor) on the map: where its ears are and what they hear. */
export type Seat = { x: number; y: number; z: number; part: Part; db: number };

/** The coverage map over the whole bowl, a cell a metre square at every seat's own height. */
export function bowl(w: World): Seat[] {
  const src = sources(w), out: Seat[] = [];
  for (const part of Object.keys(PARTS) as Part[]) for (const z of PARTS[part]) {
    for (let x = z.x0 + 0.5; x < z.x1; x++) for (let zz = z.z0 + 0.5; zz < z.z1; zz++) {
      const p = { x, y: earAt(x, zz), z: zz };
      out.push({ ...p, part, db: src.length ? levelAt(src, p, "high") : -Infinity });
    }
  }
  return out;
}

/** Whether the desk is out at front of house (set down there, not in your hands). */
export function deskAtFoh(w: World): boolean {
  const d = w.items.find((i) => i.key === "desk"), f = ZONES.foh;
  return !!d && d.key !== w.held?.key && d.x >= f.x0 && d.x <= f.x1 && d.z >= f.z0 && d.z <= f.z1;
}

export type Score = {
  /** Each part's share of seats within WINDOW dB of TARGET, 0 to 1. */
  covered: Record<Part, number>;
  /** Each part's level, dB (null when silent). */
  level: Record<Part, number | null>;
  desk: boolean;
  score: number;
  pass: boolean;
};

const r2 = (v: number) => Math.round(v * 100) / 100;
/** How the bowl sounds: each part's coverage by its weight; it passes only with the desk out at front of house. */
export function score(w: World, seats: Seat[] = bowl(w)): Score {
  const covered = {} as Record<Part, number>, level = {} as Record<Part, number | null>;
  let s = 0;
  for (const part of Object.keys(WEIGHTS) as Part[]) {
    const dbs = seats.filter((c) => c.part === part).map((c) => c.db), m = mean(dbs);
    covered[part] = r2(dbs.filter((d) => Math.abs(d - TARGET) <= WINDOW).length / Math.max(1, dbs.length));
    level[part] = Number.isFinite(m) ? Math.round(m * 10) / 10 : null;
    s += WEIGHTS[part] * covered[part];
  }
  const desk = deskAtFoh(w), total = Math.round(s);
  return { covered, level, desk, score: total, pass: desk && total >= PASS };
}

/** The show when the doors open: the bowl's sound scaled by the crowd's mood, and the pay. */
export function show(w: World) {
  const s = score(w), d = doors(w.level.name, w.t), total = showScore(s.score, d.mood);
  return { sound: s.score, mood: d.mood, late: Math.round(d.late), pay: d.pay, fee: d.fee, score: total, pass: s.desk && total >= PASS };
}
export type Show = ReturnType<typeof show>;

/** What the harness adds for the arena: each point's hang, its load against its limit, and the score. */
export function arenaState(w: World) {
  const h = hangsOf(w);
  return {
    master: rig(w).master,
    points: Object.fromEntries(POINTS.map((p) => [p.key, { ...h[p.key], boxes: h[p.key].boxes.length, kg: loadKg(h[p.key]), limit: p.limitKg }])),
    under: under(w)?.key ?? null,
    ...score(w),
  };
}
