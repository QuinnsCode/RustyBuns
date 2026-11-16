// The dive bar: a narrow room with the bar along the left wall, a small stage at the back, a marked crowd area and the
// door to the street. Two powered 12" tops, their stands, an 18" sub, a mixer and two cases wait at the door. Set the tops
// on their stands, aim them (turn, tilt, raise the stand), and the score is how the room sounds: the crowd area near the
// target level, the bar quiet enough for the staff to hear orders, and the sub's bass even over the crowd. Plain data, no DOM; the page draws the heat map.
import { clamp } from "@rustybuns/util";
import { type Area, type Band, type Grid, type Source, coverage, gear as catalog, source } from "@rustybuns/gear";
import { REACH, type Item, type Level, type World } from "../sim.ts";
import { doors, showScore } from "../clock.ts";

export type Zone = { x0: number; x1: number; z0: number; z1: number };

export const DIVE_BAR: Level = {
  name: "dive-bar",
  bounds: { x0: -2.25, x1: 2.25, z0: 0.25, z1: 13.5 },
  room: { x0: -2.5, x1: 2.5, z0: 0, z1: 12, height: 2.7, door: 1.6 },
  outlets: [{ key: "stage-outlet", x: 0, y: 0.3, z: 0.01 }, { key: "bar-outlet", x: -2.49, y: 0.3, z: 4.5 }],
  start: { x: 0, z: 12.8, yaw: 0 },
  items: [
    { key: "top-l", gear: "top-12-powered", x: -1.0, y: 0, z: 10.4, rot: 0 },
    { key: "top-r", gear: "top-12-powered", x: -0.4, y: 0, z: 10.4, rot: 0 },
    { key: "stand-l", gear: "stand-tripod", x: 1.6, y: 0, z: 9.2, rot: 0 },
    { key: "stand-r", gear: "stand-tripod", x: 1.6, y: 0, z: 10.6, rot: 0 },
    { key: "sub", gear: "sub-18", x: 0.4, y: 0, z: 10.4, rot: 0 },
    { key: "mixer", gear: "mixer-small", x: -1.6, y: 0.5, z: 11.4, rot: 0 },
    { key: "case-1", gear: "road-case-m", x: -1.6, y: 0, z: 11.4, rot: 0 },
    { key: "case-2", gear: "road-case-m", x: 1.6, y: 0, z: 11.6, rot: 0 },
  ],
};

/** Where things are, for the floor marks and the score. */
export const ZONES = {
  stage: { x0: -2.5, x1: 2.5, z0: 0, z1: 2.2 },
  crowd: { x0: -0.9, x1: 2.3, z0: 3, z1: 8.5 },
  /** The strip in front of the counter, where orders are shouted. */
  bar: { x0: -2.4, x1: -1.3, z0: 5, z1: 11 },
  counter: { x0: -2.5, x1: -1.9, z0: 5, z1: 11 },
} satisfies Record<string, Zone>;

/** The crowd should hear this, mids and highs, in dB SPL. */
export const TARGET = 100;
/** Within this many dB of the target counts. */
export const WINDOW = 4;
/** The bar should sit this far under the crowd. */
export const BAR_GAP = 5;
export const PASS = 85;
/** The kick's fundamental, Hz: under the tops' low cut, so only subs play it, summed with phase. */
export const LOW_FREQ = 50;

/** What the dive bar adds to a world: each top's tilt, each stand's height, the master fader. */
export type Rig = { tilt: Record<string, number>; stand: Record<string, number>; master: number };
const rigs = new WeakMap<World, Rig>();
export function rig(w: World): Rig {
  let r = rigs.get(w);
  if (!r) rigs.set(w, (r = { tilt: {}, stand: {}, master: -14 }));
  return r;
}

const MAX_TILT = Math.PI / 6;
export const STAND_MIN = 1.2, STAND_MAX = 2.0;
const isSpeaker = (i: Item) => !!catalog(i.gear).speaker;
/** A stand's pole height, metres. */
export const standHeight = (w: World, key: string) => rig(w).stand[key] ?? STAND_MIN;

/** The stand a piece sits on, if it sits on one: over its pole, at its height. */
function standUnder(w: World, i: Item): Item | null {
  for (const s of w.items) {
    if (s.gear !== "stand-tripod" || s === i || s.key === w.held?.key) continue;
    if (Math.hypot(s.x - i.x, s.z - i.z) < 0.45 && i.y > 0.9) return s;
  }
  return null;
}

/** After a put-down or a stand moves: a top set on a stand sits on its pole at its height. */
export function settle(w: World) {
  for (const i of w.items) {
    if (i.key === w.held?.key || i.gear === "stand-tripod") continue;
    const s = standUnder(w, i);
    if (s) Object.assign(i, { x: s.x, z: s.z, y: s.y + standHeight(w, s.key) });
  }
}

export type Answer = { ok: true } | { ok: false; why: string };
function reach(w: World, key: string): Item | string {
  const i = w.items.find((x) => x.key === key);
  if (!i) return `no ${key} here`;
  if (w.held) return "your hands are full";
  if (Math.hypot(i.x - w.you.x, i.z - w.you.z) > REACH + 0.4) return `${catalog(i.gear).what} is out of reach`;
  return i;
}

/** Turn a placed speaker by `turn` and tilt it by `tilt` (radians; tilt up is positive, up to 30 degrees either way). */
export function aim(w: World, key: string, { turn = 0, tilt = 0 }: { turn?: number; tilt?: number }): Answer {
  const i = reach(w, key);
  if (typeof i === "string") return { ok: false, why: i };
  if (!isSpeaker(i)) return { ok: false, why: `${catalog(i.gear).what} isn't a speaker` };
  i.rot += turn;
  const r = rig(w);
  r.tilt[key] = clamp((r.tilt[key] ?? 0) + tilt, -MAX_TILT, MAX_TILT);
  return { ok: true };
}

/** Raise or lower a stand (and what sits on it) to `height` metres, 1.2 to 2. */
export function raise(w: World, key: string, height: number): Answer {
  const i = reach(w, key);
  if (typeof i === "string") return { ok: false, why: i };
  if (i.gear !== "stand-tripod") return { ok: false, why: `${catalog(i.gear).what} isn't a stand` };
  rig(w).stand[key] = clamp(height, STAND_MIN, STAND_MAX);
  settle(w);
  return { ok: true };
}

/** The master fader in dB (0 is the speakers' rated power, -30 is quiet). */
export function master(w: World, db: number) {
  rig(w).master = clamp(db, -30, 0);
}

/** The speakers playing (those `plays` lets through): every one placed (not in someone's hands), facing the way it was set, from its horn. */
export function sources(w: World, plays: (i: Item) => boolean = () => true): Source[] {
  const r = rig(w);
  return w.items.filter((i) => isSpeaker(i) && i.key !== w.held?.key && plays(i)).map((i) => {
    const spec = catalog(i.gear).speaker!, h = catalog(i.gear).size.h;
    return source(i.gear, { x: i.x, y: i.y + h * 0.65, z: i.z }, { yaw: i.rot, pitch: r.tilt[i.key] ?? 0, watts: spec.ratedWatts * 10 ** (r.master / 10) });
  });
}

/** The whole floor at ear height, in cells about 20 cm across. */
export const FLOOR: Area = { x0: -2.5, x1: 2.5, z0: 0, z1: 12, y: 1.6, nx: 25, nz: 60 };

/** The heat map in one band: mids and highs, or the subs' bass. No speaker playing reads as silence (-Infinity in every cell). */
export const heat = (w: World, band: Band = "high"): Grid => coverage(sources(w), FLOOR, band, LOW_FREQ);

/** The cells of a grid inside a zone. */
export const cellsIn = (g: Grid, z: Zone) => {
  const out: number[] = [], dx = (g.x1 - g.x0) / g.nx, dz = (g.z1 - g.z0) / g.nz;
  for (let iz = 0; iz < g.nz; iz++) for (let ix = 0; ix < g.nx; ix++) {
    const x = g.x0 + (ix + 0.5) * dx, y = g.z0 + (iz + 0.5) * dz;
    if (x >= z.x0 && x <= z.x1 && y >= z.z0 && y <= z.z1) out.push(g.db[iz * g.nx + ix]);
  }
  return out;
};
/** Mean level as power, so one loud spot counts as loud; silence stays silence. */
export const mean = (dbs: number[]) => {
  const p = dbs.reduce((s, d) => s + (Number.isFinite(d) ? 10 ** (d / 10) : 0), 0) / Math.max(1, dbs.length);
  return p > 0 ? 10 * Math.log10(p) : -Infinity;
};

export type Score = {
  /** Share of the crowd area within WINDOW dB of TARGET, 0 to 1. */
  covered: number;
  crowd: number | null;
  bar: number | null;
  /** How far the bar sits under the crowd, dB. */
  gap: number | null;
  /** Share of the crowd area whose bass sits within WINDOW dB of TARGET, 0 to 1: a sub near the crowd booms up close and fades at the back. */
  bass: number;
  score: number;
  pass: boolean;
};

const near = (dbs: number[]) => dbs.filter((d) => Math.abs(d - TARGET) <= WINDOW).length / dbs.length;

/** How the room sounds: 55 points for the crowd area at the target level, 25 for a bar the staff can hear orders at, 20 for even bass. */
export function score(w: World, g: Grid = heat(w), low: Grid = heat(w, "low")): Score {
  const crowd = cellsIn(g, ZONES.crowd), bar = cellsIn(g, ZONES.bar);
  const covered = near(crowd), bass = near(cellsIn(low, ZONES.crowd));
  const c = mean(crowd), b = mean(bar), live = Number.isFinite(c);
  const gap = live ? c - (Number.isFinite(b) ? b : 0) : null;
  const quiet = gap === null ? 0 : clamp(gap / BAR_GAP, 0, 1);
  const s = Math.round(55 * covered + 25 * quiet * covered + 20 * bass);
  const r1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  return { covered: Math.round(covered * 100) / 100, crowd: r1(c), bar: r1(b), gap: gap === null ? null : Math.round(gap * 10) / 10, bass: Math.round(bass * 100) / 100, score: s, pass: s >= PASS };
}

/** The show when the doors open: the room's sound scaled by the crowd's mood (late doors sour it), and the pay. */
export function show(w: World) {
  const s = score(w), d = doors(w.level.name, w.t), total = showScore(s.score, d.mood);
  return { sound: s.score, mood: d.mood, late: Math.round(d.late), pay: d.pay, fee: d.fee, score: total, pass: total >= PASS };
}
export type Show = ReturnType<typeof show>;

/** What the harness adds for the dive bar: the rig and the score. */
export function barState(w: World) {
  const r = rig(w), deg = (v: number) => Math.round((v * 180) / Math.PI);
  return { master: r.master, tilt: Object.fromEntries(Object.entries(r.tilt).map(([k, v]) => [k, deg(v)])), stands: { ...r.stand }, ...score(w) };
}
