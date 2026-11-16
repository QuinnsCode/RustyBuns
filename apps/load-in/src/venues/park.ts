// The park: a Saturday community event with a pop-up tent stage and no wall power. The truck is at the gate; the
// generator rides on wheels (90 kg, too heavy to lift), so you push it in, run the long power cable to the distro in the
// tent, and feed the tops and the mixer from there, all inside the generator's kVA. People walk the park's paths, so a
// cable across one needs a ramp. Across the road are houses: the score adds the level at their property line, which
// has a noise limit, to the crowd's coverage. Plain data, no DOM; the page (park-view.ts) draws it.
import { clamp } from "@rustybuns/util";
import { type Area, type Feed, type Grid, coverage, gear as catalog, generatorLoad } from "@rustybuns/gear";
import { REACH, type Answer, type Level, type World, wheeled } from "../sim.ts";
import { assist } from "../assists.ts";
import { doors, showScore } from "../clock.ts";
import { type Cables, hazards, patch } from "../cables/cables.ts";
import { type Zone, WINDOW, cellsIn, mean, sources } from "./dive-bar.ts";

export const PARK: Level = {
  name: "park",
  outdoor: true,
  bounds: { x0: -14, x1: 14, z0: 0.3, z1: 32 },
  room: { x0: -14, x1: 14, z0: 0, z1: 32, height: 0, door: 0 },
  outlets: [],
  walkways: [
    { name: "the lakeside path", x0: -14, x1: 14, z0: 18.2, z1: 19.2 },
    { name: "the dog walk", x0: 8.5, x1: 9.7, z0: 0.3, z1: 32 },
  ],
  start: { x: 0, z: 31.5, yaw: 0 },
  // Everything comes off the truck's tail at the gate.
  items: [
    { key: "generator", gear: "generator-7kva", x: 0, y: 0, z: 29.6, rot: 0 },
    { key: "distro", gear: "distro-box", x: -1.6, y: 0, z: 30.4, rot: 0 },
    { key: "case", gear: "road-case-m", x: 1.6, y: 0, z: 30.4, rot: 0 },
    { key: "mixer", gear: "mixer-small", x: 1.6, y: 0.5, z: 30.4, rot: 0 },
    { key: "top-l", gear: "top-12-powered", x: -2.6, y: 0, z: 29.4, rot: 0 },
    { key: "top-r", gear: "top-12-powered", x: -3.2, y: 0, z: 29.4, rot: 0 },
    { key: "stand-l", gear: "stand-tripod", x: 3.0, y: 0, z: 29.2, rot: 0 },
    { key: "stand-r", gear: "stand-tripod", x: 4.2, y: 0, z: 29.2, rot: 0 },
    { key: "ramp-1", gear: "cable-ramp-2ch", x: -4.4, y: 0, z: 30.6, rot: 0 },
    { key: "ramp-2", gear: "cable-ramp-2ch", x: -4.4, y: 0, z: 29.8, rot: 0 },
  ],
  // Out of doors the runs are long: 25 m from the generator to the distro, then the tent's own.
  caseLoad: [
    { key: "power-25", kind: "power", lengthM: 25 },
    { key: "power-10a", kind: "power", lengthM: 10 },
    { key: "power-10b", kind: "power", lengthM: 10 },
    { key: "power-5", kind: "power", lengthM: 5 },
    { key: "xlr-10a", kind: "xlr", lengthM: 10 },
    { key: "xlr-10b", kind: "xlr", lengthM: 10 },
  ],
};

/** Where things are: the tent, the crowd on the grass, the road and the houses' property line across it. */
export const ZONES = {
  tent: { x0: -3.5, x1: 3.5, z0: 0, z1: 4 },
  crowd: { x0: -6, x1: 6, z0: 6, z1: 16 },
  road: { x0: -14, x1: 14, z0: 34, z1: 41 },
  /** The houses' front gardens, measured at the property line. */
  houses: { x0: -14, x1: 14, z0: 42, z1: 44 },
} satisfies Record<string, Zone>;

/** The crowd should hear this, mids and highs, dB SPL: an afternoon in the park, not a club. */
export const TARGET = 95;
/** The council's limit at the houses' property line, dB. */
export const SPILL_LIMIT = 82;
export const PASS = 85;

/** The whole park and the road, at ear height, in 1 m cells. */
export const GROUND: Area = { x0: -14, x1: 14, z0: 0, z1: 44, y: 1.6, nx: 28, nz: 44 };


/** Take the generator's handle and push it (F on it): it rolls in front of you (`pushSpeed`, lighter on Cozy). F again lets go. */
export function push(w: World, key: string): Answer {
  const i = w.items.find((x) => x.key === key);
  if (!i) return { ok: false, why: `no ${key} here` };
  const g = catalog(i.gear);
  if (!wheeled(i.gear)) return { ok: false, why: `${g.what} has no wheels` };
  if (w.held) return { ok: false, why: "your hands are full" };
  if (Math.hypot(i.x - w.you.x, i.z - w.you.z) > REACH) return { ok: false, why: `${g.what} is out of reach` };
  w.held = { key, rel: i.rot - w.you.yaw };
  return { ok: true };
}

/** The generator's load now: what is plugged into power hangs off it (the park has no other power). */
export function load(w: World, c: Cables): (Feed & { gear: string }) | null {
  const gen = w.items.find((i) => wheeled(i.gear));
  if (!gen) return null;
  const powered = new Set(c.runs.flatMap((r) => r.kind === "power" ? [r.a, r.b] : []).flatMap((e) => ("plug" in e ? [e.plug[0]] : [])));
  const on = w.items.filter((i) => powered.has(i.key) && catalog(i.gear).draw).map((i) => i.gear);
  const f = generatorLoad(gen.gear, on);
  return { gear: gen.gear, ...f, trips: f.trips && assist("breakersTrip") };
}

/** Whether the generator's breaker has tripped: everything on it goes dark. On Cozy it never trips. */
const trips = (problems: string[]) => assist("breakersTrip") && problems.some((p) => p.includes("trips"));
export const tripped = (w: World, c: Cables) => trips(patch(w, c).problems);

/** The speakers that play: the patch feeds them (power from the generator, signal from the mixer) and nothing tripped. */
export function playing(w: World, c: Cables): Set<string> {
  const { fed, problems } = patch(w, c);
  if (trips(problems)) return new Set();
  return new Set(Object.entries(fed).filter(([, on]) => on).map(([k]) => k));
}

/** The heat map over the park and the road: only the fed speakers. */
export function heat(w: World, c: Cables): Grid {
  const on = playing(w, c);
  return coverage(sources(w, (i) => on.has(i.key)), GROUND, "high");
}

export type Score = {
  /** Share of the crowd within WINDOW dB of TARGET, 0 to 1. */
  covered: number;
  crowd: number | null;
  /** Level at the houses' property line, dB (the loudest cell: one garden over the limit is a complaint). */
  houses: number | null;
  /** Cables across a path with no ramp. */
  hazards: number;
  tripped: boolean;
  score: number;
  pass: boolean;
};

/** 60 points for the crowd at the target, 25 for the houses under the limit (5 dB over is none), 15 for clear paths. */
export function score(w: World, c: Cables, g: Grid = heat(w, c)): Score {
  const crowd = cellsIn(g, ZONES.crowd), houses = cellsIn(g, ZONES.houses);
  const covered = crowd.filter((d) => Math.abs(d - TARGET) <= WINDOW).length / crowd.length;
  const loudest = Math.max(...houses), live = Number.isFinite(loudest);
  const quiet = live ? clamp(1 - (loudest - SPILL_LIMIT) / 5, 0, 1) : 1;
  const crossings = hazards(w, c).length, off = tripped(w, c);
  const s = Math.round(covered * (60 + 25 * quiet + (crossings ? 0 : 15)));
  const r1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  return { covered: Math.round(covered * 100) / 100, crowd: r1(mean(crowd)), houses: r1(loudest), hazards: crossings, tripped: off, score: s, pass: s >= PASS };
}

/** Show time: the sound as the crowd takes it, scaled by their mood (late doors cost it), and the pay. */
export function show(w: World, c: Cables) {
  const s = score(w, c), d = doors(w.level.name, w.t), total = showScore(s.score, d.mood);
  return { sound: s.score, mood: d.mood, late: Math.round(d.late), pay: d.pay, fee: d.fee, score: total, pass: total >= PASS };
}
export type Show = ReturnType<typeof show>;

/** What the harness adds for the park: the generator's load and the score. */
export function parkState(w: World, c: Cables) {
  const l = load(w, c);
  return { generator: l && { watts: Math.round(l.watts), limit: Math.round(l.limit), warn: l.warn, trips: l.trips }, spillLimit: SPILL_LIMIT, ...score(w, c) };
}
