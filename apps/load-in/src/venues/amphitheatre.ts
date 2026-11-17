// The red-rock amphitheatre: the top of the ladder. An open-air bowl cut between two huge slanted sandstone walls,
// the stage at the bottom under a roof, seventy rows of benches climbing 30 m over 100 m of run (about 9,500 people),
// a third rock behind the stage, and houses down the valley with a level limit and a curfew. The air is thin and dry
// at 1,950 m, so the highs die on the way up; the walls throw a slap back at the side seats; the evening breeze runs
// down the bowl and a night inversion bends the sound to the houses. The job: fly two main hangs from the roof (each
// point has its limit), pin the splays for the rake, aim them off the rock, brighten the long-throw boxes, put the
// delay towers up halfway and time them to the mains, turn the subs cardioid so the stage and the back rock don't boom,
// and stay under the limits at the desk and at the houses. Plain data, no DOM; the page (amphitheatre-view.ts) draws it.
import { clamp } from "@rustybuns/util";
import {
  type Arrival, type Face, type Source, type Vec3, ECHO_DB, MAX_SPLAY_DEG, aimTo, airAbsorption, arrayPoses, barrierLoss, bendAngle,
  echoOf, gear as catalog, levelAt, levelAt1m, offAxisLoss, pressureAt, reflection, source, speedOfSound, splayCalc, sumPower,
  weatherAtDistance,
} from "@rustybuns/gear";
import { type Answer, type Item, type Level, type World } from "../sim.ts";
import { doors, showScore } from "../clock.ts";
import { rig } from "./dive-bar.ts";

// ---- the place ---------------------------------------------------------------------------------------------------

/** The stage deck is y = 0, its lip at z = 0; the house climbs toward -z. */
export const ROWS = 70;
/** 30 m of rise over 100 m of run, row 1 to row 70: a rake of about 17 degrees, each bench 1.45 m deep, 0.43 m up. */
export const RUN = 100 / (ROWS - 1), RISE = 30 / (ROWS - 1);
/** Row 1's bench: 6 m out from the lip, 1.2 m under the deck (a stage at shoulder height to the front row). */
const ROW1_Z = -6, ROW1_Y = -1.2;
export const rowZ = (r: number) => ROW1_Z - (r - 1) * RUN;
export const rowFloor = (r: number) => ROW1_Y + (r - 1) * RISE;
/** Half the bowl's width at a row: 20 m at the front, 44 m at the top. With 0.47 m a seat that is about 9,500 seats. */
export const halfWidth = (r: number) => 20 + (24 * (r - 1)) / (ROWS - 1);
/** Standing ears, metres over the bench. */
export const EAR = 1.6;
/** The row a point on the ground is in (0 in the pit, ROWS + 1 on the top walk). */
export function rowAt(z: number): number {
  if (z > ROW1_Z + RUN / 2) return 0;
  return Math.min(ROWS + 1, Math.max(1, Math.round((ROW1_Z - z) / RUN) + 1));
}
/** The ground under you: the deck, the pit, a bench, or the walk along the top. You climb the steps as you walk. */
export function floorAt(x: number, z: number): number {
  if (z >= 0) return 0;
  const r = rowAt(z);
  if (r === 0) return ROW1_Y;
  return r > ROWS ? rowFloor(ROWS) + RISE : rowFloor(r);
}
/** The desk's mark: the middle of row 30, where a front-of-house tent sits in a bowl this size. */
export const DESK_ROW = 30;
export const DESK: Vec3 = { x: 0, y: rowFloor(DESK_ROW) + EAR, z: rowZ(DESK_ROW) };

/** A rock wall: a plane through the bowl's edge (4 m past the end of each row), leaning 20 degrees out from upright, as
 * the big slabs do, 90 m tall. Its normal points into the bowl and up. */
function wall(side: -1 | 1): Face {
  const x0 = side * (halfWidth(1) + 4), x1 = side * (halfWidth(ROWS) + 4), z0 = rowZ(1), z1 = rowZ(ROWS);
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), lean = (20 * Math.PI) / 180;
  // The flat normal pointing into the bowl, then tipped up by the lean.
  let nx = -dz / len, nz = dx / len;
  if (nx * side > 0) nx = -nx, nz = -nz;
  return { at: { x: x0, y: 0, z: z0 }, normal: { x: nx * Math.cos(lean), y: Math.sin(lean), z: nz * Math.cos(lean) }, z0: z1 - 10, z1: 12, top: 90 };
}
export const WALLS = { left: wall(-1), right: wall(1) };
/** The rock behind the stage: 60 m tall, 30 m back from the lip. */
export const BACK_ROCK = { z: 30, top: 60 };
/** The nearest houses: down the valley behind the stage, 1.5 km off and 60 m lower. */
export const HOUSE: Vec3 = { x: 0, y: -60, z: 1500 };

// ---- the air -----------------------------------------------------------------------------------------------------

/** The air at one time of day: temperature (C), relative humidity (%), the breeze along the bowl (m/s, positive up
 * the bowl toward the top rows), and the temperature gradient over the first tens of metres (K per metre). */
export type Air = { tempC: number; humidity: number; wind: number; gradient: number; label: string };
/** The venue's altitude, metres, and its air pressure there. */
export const ALTITUDE = 1950;
export const KPA = pressureAt(ALTITUDE);
/** Soundcheck, 3 pm: hot and dry, the sun-warmed slope pulls a breeze up the bowl, the air lapses normally. */
export const SOUNDCHECK: Air = { tempC: 30, humidity: 12, wind: 3, gradient: -0.0098, label: "3 pm soundcheck" };
/** The show, 8 to 11 pm: cooler, the slope flow turns and drains down the bowl, and an inversion forms over the valley. */
export const SHOW: Air = { tempC: 17, humidity: 22, wind: -2, gradient: 0.03, label: "8 pm show" };
const airs = new WeakMap<World, Air>();
/** The air the show will play in (what the score hears). */
export const airOf = (w: World): Air => airs.get(w) ?? SHOW;
export function setAir(w: World, a: Partial<Air>) { airs.set(w, { ...airOf(w), ...a }); }

// ---- the gear ----------------------------------------------------------------------------------------------------

export const BOX = "line-array-box";
const BOX_H = catalog(BOX).size.h, BOX_KG = catalog(BOX).kg;
export const TOWER_BOX = "line-array-10";
/** The flying frame, and the chain motor and its chain hanging off the point, kg (a 1 t motor with 20 m of chain). */
export const FRAME_KG = 60, MOTOR_KG = 65;
/** The roof's grid height and the highest a frame trims under it. */
export const ROOF_Y = 18, MAX_TRIM = 16;
/** The most boxes one frame takes. */
export const MAX_BOXES = 16;
/** Chain motors climb about 4 m a minute; the crew pins a box on in about 40 s. */
export const MOTOR_SPEED = 4 / 60, PIN_S = 40;
/** Nobody stands under a hang while its motor runs, and the controller is in the wing within reach of its point. */
export const CLEAR = 2.5, CONTROL = 8;
/** The two waveguide settings on the boxes' horns, degrees of horizontal coverage. */
export const HORNS = { wide: catalog(BOX).speaker!.coverage.h, narrow: 70 } as const;
export type Horn = keyof typeof HORNS;
/** How bright the long-throw boxes can be shaded, dB at 8 kHz (a high shelf on the processor's top-box channels). */
export const MAX_BRIGHT = 12;

export type Point = { key: string; name: string; x: number; z: number; side: -1 | 1; limitKg: number; plan: number; far: Vec3; near: Vec3 };
/** The roof's two main points, rated 1.1 t each: the hang, the frame and the motor all count. */
export const POINTS: readonly Point[] = ([-1, 1] as const).map((side) => ({
  key: side < 0 ? "main-l" : "main-r", name: side < 0 ? "main left" : "main right", side,
  x: side * 13, z: 1, limitKg: 1100, plan: 15,
  far: { x: side * 14, y: rowFloor(ROWS) + EAR, z: rowZ(ROWS) },
  near: { x: side * 12, y: rowFloor(1) + EAR, z: rowZ(1) },
}));
export const point = (key: string) => POINTS.find((p) => p.key === key) ?? null;

/** The delay towers: one each side at row 36, a 9 m mast with six smaller boxes aimed up the top half of the bowl. */
export const TOWER_ROW = 36, TOWER_H = 9, TOWER_BOXES = 6;
/** The towers stand in the side aisles by the rock, out of the seats (a box's back still leaks, 22 dB down, and close
 * behind a tower that is loud enough to hear late), turned in toward the middle with the narrow horns. */
export const TOWER_TOE = 22;
const towerYaw = (side: -1 | 1) => Math.PI - side * rad(TOWER_TOE);
export const TOWERS = ([-1, 1] as const).map((side) => ({ key: side < 0 ? "tower-l" : "tower-r", side, x: side * (halfWidth(TOWER_ROW) + 1.5), z: rowZ(TOWER_ROW), y: rowFloor(TOWER_ROW) + TOWER_H }));
/** The crew needs ten minutes to put both towers up (or down). */
export const TOWER_S = 600;
/** The subs: six pairs on the pit floor under the lip, the back row 0.8 m behind the front. */
export const SUB_X = [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5], SUB_Z = -1.6, SUB_GAP = 0.8;
export type SubMode = "forward" | "cardioid";

const stack = (prefix: string, gear: string, n: number, x: number, z: number, h: number): Item[] =>
  Array.from({ length: n }, (_, k) => ({ key: `${prefix}-${k + 1}`, gear, x: x + Math.floor(k / 4) * 1.2, y: (k % 4) * h, z, rot: 0 }));

export const AMPHITHEATRE: Level = {
  name: "amphitheatre",
  outdoor: true,
  bounds: { x0: -46, x1: 46, z0: -110, z1: 16 },
  room: { x0: -46, x1: 46, z0: -110, z1: 16, height: 18, door: 8 },
  outlets: [],
  start: { x: 0, z: 8, yaw: 0 },
  floorAt,
  items: [
    ...stack("l", BOX, MAX_BOXES, -12.5, 9, BOX_H), ...stack("r", BOX, MAX_BOXES, 9, 9, BOX_H),
    ...stack("tl", TOWER_BOX, TOWER_BOXES, -4, 12.5, catalog(TOWER_BOX).size.h), ...stack("tr", TOWER_BOX, TOWER_BOXES, 2, 12.5, catalog(TOWER_BOX).size.h),
    ...SUB_X.flatMap((x, k) => [
      { key: `sub-${k + 1}`, gear: "sub-18", x, y: ROW1_Y, z: SUB_Z, rot: 0 },
      { key: `sub-${k + 7}`, gear: "sub-18", x, y: ROW1_Y, z: SUB_Z + SUB_GAP, rot: 0 },
    ]),
    { key: "desk", gear: "mixer-small", x: DESK.x, y: rowFloor(DESK_ROW) + 0.75, z: DESK.z, rot: 0 },
  ],
};

// ---- the rig -----------------------------------------------------------------------------------------------------

/** A hang: how many boxes, the top box's angle and the pins below it (degrees), the trim once flown, the trim planned,
 * whether the point is checked, the toe-in (degrees toward the middle), the horn setting, and the long-throw shading. */
export type Hang = { boxes: number; tilt: number; splays: number[]; trim: number | null; plan: number; checked: boolean; toe: number; horn: Horn; bright: number };
export type Rig = { hangs: Record<string, Hang>; towers: boolean; delayMs: number; towerBright: number; subs: SubMode };
const rigs = new WeakMap<World, Rig>();
export function amp(w: World): Rig {
  let r = rigs.get(w);
  if (!r) {
    const hangs = Object.fromEntries(POINTS.map((p) => [p.key, { boxes: 0, tilt: 0, splays: [], trim: null, plan: p.plan, checked: false, toe: 0, horn: "wide" as Horn, bright: 0 }]));
    rigs.set(w, (r = { hangs, towers: false, delayMs: 0, towerBright: 0, subs: "forward" }));
  }
  return r;
}

export const loadKg = (h: Hang) => h.boxes * BOX_KG + FRAME_KG + MOTOR_KG;
const lowTrim = (h: Hang) => 0.4 + h.boxes * BOX_H;
export const frameY = (h: Hang) => h.trim ?? lowTrim(h);
const rad = (d: number) => (d * Math.PI) / 180;
const boxKey = (p: Point, k: number) => `${p.side < 0 ? "l" : "r"}-${k + 1}`;
/** Which way a hang faces: down the bowl (-z), turned in toward the middle by its toe. */
export const yawOf = (p: Point, h: Hang) => Math.PI - p.side * rad(h.toe);

/** Every box of a hang where it hangs (and the rest back on their stacks), so the sound and the page see it. */
function pose(w: World, p: Point) {
  const h = amp(w).hangs[p.key], yaw = yawOf(p, h);
  const poses = arrayPoses({ x: p.x, y: frameY(h), z: p.z }, yaw, rad(h.tilt), h.splays.map(rad), h.boxes, BOX_H);
  for (let k = 0; k < MAX_BOXES; k++) {
    const i = w.items.find((o) => o.key === boxKey(p, k))!, home = AMPHITHEATRE.items.find((o) => o.key === i.key)!;
    if (k < h.boxes) {
      const b = poses[k];
      Object.assign(i, { x: b.centre.x, y: b.centre.y - BOX_H / 2, z: b.centre.z, rot: yaw, hung: true });
      rig(w).tilt[i.key] = b.pitch;
    } else {
      Object.assign(i, { x: home.x, y: home.y, z: home.z, rot: 0 });
      delete i.hung;
      delete rig(w).tilt[i.key];
    }
  }
}

function at(w: World, key: string, reach = CONTROL): { p: Point; h: Hang } | string {
  const p = point(key);
  if (!p) return `no rigging point ${key}`;
  if (Math.hypot(p.x - w.you.x, p.z - w.you.z) > reach || w.you.z < 0) return `go to the ${p.name} point's controller on the stage`;
  return { p, h: amp(w).hangs[key] };
}
const onDeck = (a: { p: Point; h: Hang }) => (a.h.trim === null ? null : `the ${a.p.name} hang is in the air: land it first`);

/** The point whose controller you stand at, if any. */
export function near(w: World): Point | null {
  if (w.you.z < 0) return null;
  let best: Point | null = null, bd = CONTROL;
  for (const p of POINTS) { const d = Math.hypot(p.x - w.you.x, p.z - w.you.z); if (d <= bd) best = p, bd = d; }
  return best;
}

/** The crew pins boxes on (or off) a hang on the deck until it has `n`; about 40 s a box. */
export function hang(w: World, key: string, n: number): Answer {
  const a = at(w, key);
  if (typeof a === "string") return { ok: false, why: a };
  const no = onDeck(a);
  if (no) return { ok: false, why: no };
  const to = Math.round(clamp(n, 0, MAX_BOXES));
  if (to === a.h.boxes) return { ok: true };
  w.t += Math.abs(to - a.h.boxes) * PIN_S;
  a.h.splays = Array.from({ length: Math.max(0, to - 1) }, (_, k) => a.h.splays[k] ?? 0);
  a.h.boxes = to;
  a.h.checked = false;
  pose(w, a.p);
  return { ok: true };
}

/** The top box's angle (up is positive) and the pins between boxes, whole degrees. On the deck. */
export function pin(w: World, key: string, tilt: number, splays: readonly number[]): Answer {
  const a = at(w, key);
  if (typeof a === "string") return { ok: false, why: a };
  const no = onDeck(a);
  if (no) return { ok: false, why: no };
  a.h.tilt = Math.round(clamp(tilt, -15, 20));
  a.h.splays = Array.from({ length: Math.max(0, a.h.boxes - 1) }, (_, k) => Math.round(clamp(splays[k] ?? 0, 0, MAX_SPLAY_DEG)));
  w.t += 60;
  pose(w, a.p);
  return { ok: true };
}

/** The splay calculator: angles for the boxes on a point now, flown at `trim`, from row 70 to row 1. */
export function calc(w: World, key: string, trim?: number) {
  const p = point(key);
  if (!p) return null;
  const h = amp(w).hangs[key];
  trim ??= h.plan;
  return { trim, boxes: h.boxes, ...splayCalc({ x: p.x, y: trim, z: p.z }, yawOf(p, h), h.boxes, BOX_H, p.far, p.near) };
}

/** Plan the trim a hang will fly at, metres (what the calculator figures for). */
export function plan(w: World, key: string, trim: number) {
  const h = point(key) && amp(w).hangs[key];
  if (h) h.plan = clamp(Math.round(trim * 2) / 2, 4, MAX_TRIM);
}

/** Toe-in (degrees toward the middle, -10 to 25) and the horns' waveguide, set on the frame's pickup on the deck. */
export function aim(w: World, key: string, toe: number, horn?: Horn): Answer {
  const a = at(w, key);
  if (typeof a === "string") return { ok: false, why: a };
  const no = onDeck(a);
  if (no) return { ok: false, why: no };
  a.h.toe = Math.round(clamp(toe, -10, 25));
  if (horn) a.h.horn = horn;
  w.t += horn ? 30 + 20 * a.h.boxes : 30;
  pose(w, a.p);
  return { ok: true };
}

/** The high shelf on the top third of a hang's boxes (or on the towers, key "towers"), dB (0 to 12): from the
 * processor, anywhere. */
export function shade(w: World, key: string, db: number): Answer {
  const v = Math.round(clamp(db, 0, MAX_BRIGHT));
  if (key === "towers") return (amp(w).towerBright = v), { ok: true };
  const h = point(key) && amp(w).hangs[key];
  if (!h) return { ok: false, why: `no rigging point ${key}` };
  h.bright = v;
  return { ok: true };
}

/** The rigger's check: what hangs on the point against what the roof takes there. */
export function check(w: World, key: string): Answer & { kg?: number; limit?: number } {
  const a = at(w, key);
  if (typeof a === "string") return { ok: false, why: a };
  const kg = loadKg(a.h), limit = a.p.limitKg;
  w.t += 30;
  a.h.checked = kg <= limit;
  return a.h.checked ? { ok: true, kg, limit } : { ok: false, why: `${kg} kg on a ${limit} kg point: take boxes off`, kg, limit };
}

/** Run a point's motor to `trim` metres, from its controller and clear of the hang. */
export function fly(w: World, key: string, trim?: number): Answer {
  const a = at(w, key);
  if (typeof a === "string") return { ok: false, why: a };
  if (!a.h.boxes) return { ok: false, why: `nothing hangs on the ${a.p.name} frame` };
  if (!a.h.checked) return { ok: false, why: `check the ${a.p.name} point before it flies` };
  if (Math.hypot(a.p.x - w.you.x, a.p.z - w.you.z) < CLEAR) return { ok: false, why: `stand clear: you're under the ${a.p.name} hang` };
  const to = clamp(trim ?? a.h.plan, lowTrim(a.h) + 0.5, MAX_TRIM);
  w.t += Math.abs(to - frameY(a.h)) / MOTOR_SPEED;
  a.h.trim = to;
  pose(w, a.p);
  return { ok: true };
}

/** Bring a hang down to the deck. */
export function land(w: World, key: string): Answer {
  const a = at(w, key);
  if (typeof a === "string") return { ok: false, why: a };
  if (a.h.trim === null) return { ok: true };
  if (Math.hypot(a.p.x - w.you.x, a.p.z - w.you.z) < CLEAR) return { ok: false, why: `stand clear: you're under the ${a.p.name} hang` };
  w.t += Math.abs(a.h.trim - lowTrim(a.h)) / MOTOR_SPEED;
  a.h.trim = null;
  pose(w, a.p);
  return { ok: true };
}

/** The tower you stand by (on its row, within a few metres), if any. */
export const atTower = (w: World) => TOWERS.find((t) => Math.hypot(t.x - w.you.x, t.z - w.you.z) < 5) ?? null;

/** Put the delay towers up (or down): the crew builds both while you stand at one to show them where. */
export function towers(w: World, up: boolean): Answer {
  if (!atTower(w)) return { ok: false, why: `climb to row ${TOWER_ROW}, where the delay towers go` };
  const r = amp(w);
  if (r.towers === up) return { ok: true };
  w.t += TOWER_S;
  r.towers = up;
  poseTowers(w);
  return { ok: true };
}

function poseTowers(w: World) {
  const r = amp(w), h = catalog(TOWER_BOX).size.h;
  for (const t of TOWERS) {
    const yaw = towerYaw(t.side), s = splayCalc({ x: t.x, y: t.y, z: t.z }, yaw, TOWER_BOXES, h, { x: t.x / 3, y: rowFloor(ROWS) + EAR, z: rowZ(ROWS) }, { x: t.x / 2, y: rowFloor(TOWER_ROW + 8) + EAR, z: rowZ(TOWER_ROW + 8) });
    const poses = arrayPoses({ x: t.x, y: t.y, z: t.z }, yaw, rad(s.tilt), s.splays.map(rad), TOWER_BOXES, h);
    for (let k = 0; k < TOWER_BOXES; k++) {
      const key = `${t.side < 0 ? "tl" : "tr"}-${k + 1}`, i = w.items.find((o) => o.key === key)!, home = AMPHITHEATRE.items.find((o) => o.key === key)!;
      if (r.towers) {
        Object.assign(i, { x: poses[k].centre.x, y: poses[k].centre.y - h / 2, z: poses[k].centre.z, rot: yaw, hung: true });
        rig(w).tilt[key] = poses[k].pitch;
      } else {
        Object.assign(i, { x: home.x, y: home.y, z: home.z, rot: 0 });
        delete i.hung;
        delete rig(w).tilt[key];
      }
    }
  }
}

/** The towers' delay, ms, from the processor (anywhere). */
export function delay(w: World, ms: number): Answer {
  amp(w).delayMs = Math.round(clamp(ms, 0, 500) * 10) / 10;
  return { ok: true };
}

/** How far behind the mains the towers land, ms: inside the arena's 0 to 20 ms window, so the two blend and the
 * ear still hears the stage first (the precedence effect). */
export const LEAD_MS = 8;

/** What the towers' delay should be at the show's temperature: the path from the nearer main hang to the tower over
 * the speed of sound, plus LEAD_MS so the mains still land first. */
export function wantDelay(w: World): number {
  const c = speedOfSound(airOf(w).tempC), t = TOWERS[0], p = POINTS[0], h = amp(w).hangs[p.key];
  return Math.round((Math.hypot(t.x - p.x, t.y - (frameY(h) - (h.boxes * BOX_H) / 2), t.z - p.z) / c) * 1000 + LEAD_MS);
}

/** The sub line by the lip (where the amps for it stand), within a few metres of it in the pit or on the deck lip. */
export const atSubs = (w: World) => Math.abs(w.you.x) < 11 && w.you.z > -5 && w.you.z < 3;

/** The subs' setting on their amp channels: all forward, or the back row turned, flipped and delayed by its spacing. */
export function subs(w: World, mode: SubMode): Answer {
  if (!atSubs(w)) return { ok: false, why: "the sub amps are at the lip of the stage" };
  const r = amp(w);
  if (r.subs === mode) return { ok: true };
  w.t += 120;
  r.subs = mode;
  for (let k = 6; k < 12; k++) w.items.find((i) => i.key === `sub-${k + 1}`)!.rot = mode === "cardioid" ? Math.PI : 0;
  return { ok: true };
}

// ---- the sound ---------------------------------------------------------------------------------------------------

const watts = (w: World, rated: number) => rated * 10 ** (rig(w).master / 10);

/** A hang's boxes as sources, each with its horn and whether it is a long-throw box (the top third). */
export function hangSources(w: World, p: Point): { src: Source; long: boolean }[] {
  const h = amp(w).hangs[p.key];
  if (h.trim === null || !h.boxes) return [];
  const spec = catalog(BOX).speaker!, speaker = { ...spec, coverage: { ...spec.coverage, h: HORNS[h.horn] } };
  return arrayPoses({ x: p.x, y: h.trim, z: p.z }, yawOf(p, h), rad(h.tilt), h.splays.map(rad), h.boxes, BOX_H)
    .map((b, k) => ({ src: { speaker, pos: b.centre, yaw: yawOf(p, h), pitch: b.pitch, watts: watts(w, spec.ratedWatts) }, long: k < Math.ceil(h.boxes / 3) }));
}

export function towerSources(w: World, side: -1 | 1): Source[] {
  if (!amp(w).towers) return [];
  const spec = catalog(TOWER_BOX).speaker!, speaker = { ...spec, coverage: { ...spec.coverage, h: HORNS.narrow } };
  return w.items.filter((i) => i.key.startsWith(side < 0 ? "tl-" : "tr-")).map((i) => ({
    speaker, pos: { x: i.x, y: i.y + catalog(TOWER_BOX).size.h / 2, z: i.z }, yaw: towerYaw(side), pitch: rig(w).tilt[i.key] ?? 0, watts: watts(w, spec.ratedWatts) }));
}

export function subSources(w: World): Source[] {
  const r = amp(w), c = speedOfSound(airOf(w).tempC), spec = catalog("sub-18").speaker!;
  return w.items.filter((i) => i.gear === "sub-18").map((i) => {
    const back = Number(i.key.slice(4)) > 6, card = back && r.subs === "cardioid";
    return source("sub-18", { x: i.x, y: i.y + 0.35, z: i.z }, { watts: watts(w, spec.ratedWatts), invert: card, delayMs: card ? (SUB_GAP / c) * 1000 : 0 });
  });
}

/** Level of one box at a seat at one frequency: spreading, its pattern (with the beam bent by the weather), and the air. */
function boxAt(s: Source, p: Vec3, absorb: number, air: Air, c: number) {
  const { h, v, d } = aimTo(s, p), dh = Math.hypot(p.x - s.pos.x, p.z - s.pos.z);
  const along = dh > 0 ? (air.wind * (s.pos.z - p.z)) / dh : 0;
  const bend = bendAngle(dh, along, air.gradient, Math.max(5, (s.pos.y + p.y) / 2 - floorAt(p.x, p.z) / 2), c);
  return { db: levelAt1m(s.speaker, s.watts) - 20 * Math.log10(Math.max(d, 0.3)) - offAxisLoss(s.speaker, h, v + bend) - absorb * d, d, bend };
}

/** One seat on the map: its row and ears, what it hears in the mids (1 kHz) and the highs (8 kHz), and its worst echo. */
export type Seat = { row: number; x: number; y: number; z: number; side: boolean; mid: number; high: number; echo: { db: number; ms: number; from: string } | null };

/** Every seat on the map: each row, nine places across it, at standing ears. */
export function seatsOf(): Vec3[] & { row?: never } {
  const out: Vec3[] = [];
  for (let r = 1; r <= ROWS; r++) for (let k = -4; k <= 4; k++) out.push({ x: ((halfWidth(r) - 1.5) * k) / 4, y: rowFloor(r) + EAR, z: rowZ(r) });
  return out;
}
const SEATS = seatsOf();

/** What every seat hears in the show's air. */
export function hear(w: World, air: Air = airOf(w)): Seat[] {
  const c = speedOfSound(air.tempC), a1 = airAbsorption(1000, air.tempC, air.humidity, KPA), a8 = airAbsorption(8000, air.tempC, air.humidity, KPA);
  const hangs = POINTS.map((p) => ({ p, h: amp(w).hangs[p.key], boxes: hangSources(w, p) })).filter((x) => x.boxes.length);
  const towers = ([-1, 1] as const).map((side) => towerSources(w, side)).filter((t) => t.length);
  const lag = amp(w).delayMs;
  return SEATS.map((p) => {
    const row = rowAt(p.z), mids: number[] = [], highs: number[] = [], arrivals: (Arrival & { from: string })[] = [];
    for (const { p: pt, h, boxes } of hangs) {
      const m: number[] = [];
      for (const { src, long } of boxes) {
        const b1 = boxAt(src, p, a1, air, c), b8 = boxAt(src, p, a8, air, c);
        m.push(b1.db);
        highs.push(b8.db + (long ? h.bright : 0));
      }
      mids.push(...m);
      const mid = boxes[boxes.length >> 1].src;
      arrivals.push({ db: sumPower(m), ms: (Math.hypot(p.x - mid.pos.x, p.y - mid.pos.y, p.z - mid.pos.z) / c) * 1000, from: pt.name });
      for (const [name, face] of Object.entries(WALLS)) {
        const rs = boxes.map((b) => reflection(b.src, face, p)).filter((r) => r !== null);
        if (rs.length) arrivals.push({ db: sumPower(rs.map((r) => r.level - a1 * r.path)), ms: (rs[rs.length >> 1].path / c) * 1000, from: `the ${name} wall` });
      }
    }
    for (const t of towers) {
      const m = t.map((s) => boxAt(s, p, a1, air, c).db);
      mids.push(...m);
      highs.push(...t.map((s) => boxAt(s, p, a8, air, c).db + amp(w).towerBright));
      const mid = t[t.length >> 1];
      arrivals.push({ db: sumPower(m), ms: (Math.hypot(p.x - mid.pos.x, p.y - mid.pos.y, p.z - mid.pos.z) / c) * 1000 + lag, from: "the delay tower" });
    }
    const e = echoOf(arrivals), worst = e && arrivals.find((a) => Math.abs(a.db - (e.db + Math.max(...arrivals.map((x) => x.db)))) < 1e-9);
    return {
      row, ...p, side: Math.abs(p.x) > halfWidth(row) * 0.5,
      mid: mids.length ? sumPower(mids) : -Infinity, high: highs.length ? sumPower(highs) : -Infinity,
      echo: e && worst ? { db: Math.round(e.db * 10) / 10, ms: Math.round(e.ms), from: worst.from } : null,
    };
  });
}

/** Mids at the desk, dB: what the venue's meter reads. */
export function deskLevel(w: World, air: Air = airOf(w)): number {
  const seats = hear(w, air);
  return seats.reduce((b, s) => (Math.hypot(s.x - DESK.x, s.z - DESK.z) < Math.hypot(b.x - DESK.x, b.z - DESK.z) ? s : b)).mid;
}

/** Over the back rock: the extra path a ray from `s` takes over its top to the house. */
const overRock = (s: Vec3) => {
  const top = { x: s.x, y: BACK_ROCK.top, z: BACK_ROCK.z };
  return Math.hypot(top.x - s.x, top.y - s.y, top.z - s.z) + Math.hypot(HOUSE.x - top.x, HOUSE.y - top.y, HOUSE.z - top.z) - Math.hypot(HOUSE.x - s.x, HOUSE.y - s.y, HOUSE.z - s.z);
};

/** The level at the houses' property line, dB: the subs' bass at 63 Hz and the hangs' mids out of their backs, over the
 * back rock (the bass bends round it, the mids don't), through the air, and the weather's say over 1.5 km. */
export function houseLevel(w: World, air: Air = airOf(w)): { db: number; low: number; mid: number; weather: number } {
  const d = Math.hypot(HOUSE.x, HOUSE.y, HOUSE.z), weather = weatherAtDistance(d, -air.wind, air.gradient > 0);
  const subsNow = subSources(w), c = speedOfSound(air.tempC);
  const low = subsNow.length ? levelAt(subsNow, HOUSE, "low", 63) - barrierLoss(overRock({ x: 0, y: 0, z: SUB_Z }), 63, c) - airAbsorption(63, air.tempC, air.humidity, KPA) * d + weather : -Infinity;
  const boxes = POINTS.flatMap((p) => hangSources(w, p).map((b) => b.src)).concat(towerSources(w, -1), towerSources(w, 1));
  const a1 = airAbsorption(1000, air.tempC, air.humidity, KPA);
  const mid = boxes.length ? sumPower(boxes.map((s) => {
    const { h, v } = aimTo(s, HOUSE);
    return levelAt1m(s.speaker, s.watts) - 20 * Math.log10(d) - offAxisLoss(s.speaker, h, v) - a1 * d - barrierLoss(overRock(s.pos), 1000, c);
  })) + weather : -Infinity;
  const db = sumPower([low, mid].filter(Number.isFinite));
  return { db: Number.isFinite(db) ? Math.round(db * 10) / 10 : -Infinity, low: Math.round(low * 10) / 10, mid: Math.round(mid * 10) / 10, weather };
}

/** The bass on the band's stage and at the back rock against row 5: how far under it they sit, dB. */
export function boom(w: World): number | null {
  const s = subSources(w);
  if (!s.length) return null;
  const front = levelAt(s, { x: 0, y: rowFloor(5) + EAR, z: rowZ(5) }, "low", 63);
  const behind = Math.max(levelAt(s, { x: 0, y: 1.6, z: 7 }, "low", 63), levelAt(s, { x: 0, y: 10, z: BACK_ROCK.z - 1 }, "low", 63));
  return Math.round((front - behind) * 10) / 10;
}

// ---- the score ---------------------------------------------------------------------------------------------------

/** The crowd should hear this in the mids, dB SPL, row 1 to row 70: a big bowl, so the arena's wider window. */
export const TARGET = 98, WINDOW = 6;
/** The venue's meter at the desk, and the property line at the houses, dB. */
export const DESK_LIMIT = 103, HOUSE_LIMIT = 60;
/** The top rows' highs may sit this far under the desk's (against their mids) and still sound right; nothing at DULL. */
export const BRIGHT_OK = 3, DULL = 9;
/** The bass on the stage should sit this far under the front rows. */
export const BOOM_GAP = 10;
export const PASS = 88;
export const WEIGHTS = { even: 30, highs: 20, echo: 25, houses: 15, boom: 10 } as const;
/** The top rows, for "highs at the top". */
export const TOP_ROWS = 56;

const tilt = (s: Seat) => s.high - s.mid;
const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const r1 = (v: number) => Math.round(v * 10) / 10;
const ramp = (v: number, full: number, none: number) => clamp((v - none) / (full - none), 0, 1);

export type Score = ReturnType<typeof score>;
/** How the bowl sounds in the show's air: even from row 1 to 70, bright at the top, no echo, quiet houses and stage. */
export function score(w: World, seats: Seat[] = hear(w)) {
  const air = airOf(w);
  const even = seats.filter((s) => Math.abs(s.mid - TARGET) <= WINDOW).length / seats.length;
  const desk = seats.reduce((b, s) => (Math.hypot(s.x - DESK.x, s.z - DESK.z) < Math.hypot(b.x - DESK.x, b.z - DESK.z) ? s : b));
  const top = seats.filter((s) => s.row >= TOP_ROWS && Number.isFinite(s.mid));
  const dull = Number.isFinite(desk.mid) && top.length ? r1(tilt(desk) - avg(top.map(tilt))) : null;
  const echoes = seats.filter((s) => s.echo && s.echo.db > ECHO_DB);
  const house = houseLevel(w, air), gap = boom(w);
  const parts = {
    even: even,
    highs: dull === null ? 0 : ramp(-dull, -BRIGHT_OK, -DULL),
    echo: Number.isFinite(desk.mid) ? 1 - echoes.length / seats.length : 0,
    houses: Number.isFinite(house.db) ? ramp(-house.db, -HOUSE_LIMIT, -HOUSE_LIMIT - 5) : 1,
    boom: gap === null ? 0 : ramp(gap, BOOM_GAP, 0),
  };
  const total = Math.round((Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((s, k) => s + WEIGHTS[k] * parts[k], 0));
  const rowMid = (r: number) => avg(seats.filter((s) => s.row === r).map((s) => s.mid));
  const deskOver = Number.isFinite(desk.mid) && desk.mid > DESK_LIMIT, houseOver = house.db > HOUSE_LIMIT;
  // Why it doesn't pass, in words a crew chief would say.
  const why: string[] = [];
  const topMid = rowMid(ROWS);
  if (!Number.isFinite(desk.mid)) why.push("nothing is flown");
  else {
    if (topMid < TARGET - WINDOW) why.push(`the top rows are quiet: row ${ROWS} hears ${r1(topMid)} dB`);
    if (rowMid(5) > TARGET + WINDOW) why.push(`the front rows are cooked: row 5 hears ${r1(rowMid(5))} dB`);
    if (dull !== null && dull > BRIGHT_OK) why.push(`the top rows are dull: their highs sit ${dull} dB under the desk's`);
    const wall = echoes.filter((s) => s.echo!.from.endsWith("wall")), tower = echoes.length - wall.length, share = (n: number) => Math.round((n / seats.length) * 100);
    if (wall.length > seats.length * 0.03) why.push(`the walls slap back: ${share(wall.length)}% of seats hear an echo off the rock`);
    // Towers in time still leak out of their backs to the seats close round them; only a wrong time is a crew mistake.
    const off = Math.abs(amp(w).delayMs - wantDelay(w)) > LEAD_MS + 2;
    if (amp(w).towers && off && tower > seats.length * 0.03) why.push(`the delay towers are out of time: ${share(tower)}% of seats hear the mains and the towers apart (set ${amp(w).delayMs} ms, want about ${wantDelay(w)})`);
  }
  if (houseOver) why.push(`the houses hear ${house.db} dB, over the ${HOUSE_LIMIT} dB limit`);
  if (gap !== null && gap < BOOM_GAP) why.push(`the stage and the back rock boom: the bass there is only ${gap} dB under the front rows`);
  if (deskOver) why.push(`the desk's meter reads ${r1(desk.mid)} dB, over the ${DESK_LIMIT} dB limit`);
  const rounded = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 100) / 100])) as typeof parts;
  return {
    parts: rounded, score: total, pass: total >= PASS && !deskOver && !houseOver, why,
    rows: { front: r1(rowMid(5)), desk: r1(desk.mid), top: r1(topMid) },
    dull, echoes: r1((echoes.length / seats.length) * 100), house, boom: gap,
  };
}

/** Show time: the bowl as the crowd takes it, scaled by mood (late doors cost it), and a hard curfew: every minute
 * late at doors is a minute cut off the end of the set, and a cut set costs the score too. */
export function show(w: World) {
  const s = score(w), d = doors(w.level.name, w.t), cut = Math.ceil(d.late / 60);
  const total = Math.max(0, showScore(s.score, d.mood) - 2 * cut);
  return { sound: s.score, mood: d.mood, late: Math.round(d.late), cut, pay: d.pay, fee: d.fee, score: total, pass: s.pass && total >= PASS };
}
export type Show = ReturnType<typeof show>;

/** What the harness adds for the amphitheatre: the hangs, the towers, the subs, the air and the score. */
export function amphitheatreState(w: World) {
  const r = amp(w), air = airOf(w);
  return {
    master: rig(w).master,
    hangs: Object.fromEntries(POINTS.map((p) => [p.key, { ...r.hangs[p.key], kg: loadKg(r.hangs[p.key]), limit: p.limitKg }])),
    near: near(w)?.key ?? null,
    towers: { up: r.towers, delayMs: r.delayMs, wantMs: wantDelay(w), bright: r.towerBright },
    subs: r.subs,
    air: {
      ...air, altitude: ALTITUDE, kPa: r1(KPA), speed: r1(speedOfSound(air.tempC)),
      /** dB the air takes over 100 m at 1 kHz and 8 kHz. */
      per100m: { k1: r1(airAbsorption(1000, air.tempC, air.humidity, KPA) * 100), k8: r1(airAbsorption(8000, air.tempC, air.humidity, KPA) * 100) },
    },
    you: { row: rowAt(w.you.z), y: r1(floorAt(w.you.x, w.you.z)) },
    ...score(w),
  };
}
