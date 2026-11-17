// The park: a Saturday community event with a pop-up tent stage and no wall power. The truck is at the gate; the
// generator rides on wheels (90 kg, too heavy to lift), so you push it in, run the long power cable to the distro in the
// tent, and feed the tops and the mixer from there, all inside the generator's kVA. People walk the park's paths, so a
// cable across one needs a ramp. Across the road are houses: the score adds the level at their property line, which
// has a noise limit, to the crowd's coverage. The generator comes with little in its tank: the jerry cans on the truck
// (18 kg full, one in your hands at a time) fill it for the whole day, and the harder it works the faster it burns. Plain data, no DOM; the page (park-view.ts) draws it.
import { clamp, mulberry32 } from "@rustybuns/util";
import { type Area, type Feed, type Grid, coverage, gear as catalog, generatorLoad, runHours } from "@rustybuns/gear";
import { REACH, type Answer, type Level, type World, heldItem } from "../sim.ts";
import { assist } from "../assists.ts";
import { doors, showScore } from "../clock.ts";
import { type Cables, hazards, patch } from "../cables/cables.ts";
import { type Zone, WINDOW, cellsIn, mean, sources } from "./dive-bar.ts";

export const PARK: Level = {
  name: "park",
  outdoor: true,
  bounds: { x0: -14, x1: 14, z0: 0.3, z1: 37.05 },
  room: { x0: -14, x1: 14, z0: 0, z1: 32, height: 0, door: 0 },
  outlets: [],
  walkways: [
    { name: "the lakeside path", x0: -14, x1: 14, z0: 18.2, z1: 19.2 },
    { name: "the dog walk", x0: 8.5, x1: 9.7, z0: 0.3, z1: 32 },
  ],
  start: { x: 0, z: 31.5, yaw: 0 },
  truck: { x0: -1.2, x1: 1.2, z0: 32.3, z1: 37.3, h: 2.4 },
  // Everything comes off the truck's tail at the gate.
  items: [
    { key: "generator", gear: "generator-7kva", x: 0, y: 0, z: 29.6, rot: 0, litres: 4 },
    { key: "can-1", gear: "jerry-can-20l", x: 2.6, y: 0, z: 31.2, rot: 0, litres: 20 },
    { key: "can-2", gear: "jerry-can-20l", x: 3.0, y: 0, z: 31.2, rot: 0, litres: 20 },
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
/** The day the generator has to last, hours: the afternoon's sets into the evening. */
export const DAY_HOURS = 8;

/** The whole park and the road, at ear height, in 1 m cells. */
export const GROUND: Area = { x0: -14, x1: 14, z0: 0, z1: 44, y: 1.6, nx: 28, nz: 44 };


/** Holding a jerry can, pour it into the generator in reach (F on it): the tank fills up to its size, the rest stays in the can. */
export function pour(w: World, key: string): Answer {
  const can = heldItem(w), gen = w.items.find((x) => x.key === key);
  if (!can || !catalog(can.gear).can) return { ok: false, why: "you hold no fuel" };
  if (!gen || !catalog(gen.gear).generator) return { ok: false, why: `no generator ${key} here` };
  if (Math.hypot(gen.x - w.you.x, gen.z - w.you.z) > REACH) return { ok: false, why: "the generator is out of reach" };
  const room = catalog(gen.gear).generator!.tankL - (gen.litres ?? 0), have = can.litres ?? 0;
  if (have <= 0) return { ok: false, why: "the can is empty" };
  if (room <= 0) return { ok: false, why: "the tank is full" };
  const l = Math.min(room, have);
  gen.litres = (gen.litres ?? 0) + l;
  can.litres = have - l;
  return { ok: true };
}

/** The generator's load now: what is plugged into power hangs off it (the park has no other power). */
export function load(w: World, c: Cables): (Feed & { gear: string; litres: number; hours: number }) | null {
  const gen = w.items.find((i) => catalog(i.gear).generator);
  if (!gen) return null;
  const powered = new Set(c.runs.flatMap((r) => r.kind === "power" ? [r.a, r.b] : []).flatMap((e) => ("plug" in e ? [e.plug[0]] : [])));
  const on = w.items.filter((i) => powered.has(i.key) && catalog(i.gear).draw).map((i) => i.gear);
  const f = generatorLoad(gen.gear, on);
  const litres = gen.litres ?? 0;
  return { gear: gen.gear, ...f, trips: f.trips && assist("breakersTrip"), litres, hours: runHours(gen.gear, f.watts, litres) };
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

/** The breeze: where it blows toward (radians on the ground, 0 = +z, toward the road and the houses; π/2 = +x) and
 * how hard, m/s. */
export type Wind = { toward: number; speed: number };
/** dB the mids and highs gain per metre downwind, per m/s of breeze (and lose upwind): 5 m/s is +4 dB at 40 m. */
export const WIND_DB = 0.02;
/** No breeze bends the sound more than this, either way, dB. */
export const WIND_MAX = 8;

const winds = new WeakMap<World, (t: number) => Wind>();
/** The breeze this run (`blow(w, windFor(seed))`, or a fixed one in a test). A world nobody gave a wind is calm. */
export const blow = (w: World, f: (t: number) => Wind) => void winds.set(w, f);
/** The breeze now, at the world's clock. */
export const wind = (w: World): Wind => winds.get(w)?.(w.t) ?? { toward: 0, speed: 0 };

/** A seeded breeze for one run: a direction from anywhere, 1 to 6 m/s, that swings and gusts as the day goes on
 * (minutes, not seconds), so a fader set at the start is wrong an hour of game time later. */
export function windFor(seed: number): (t: number) => Wind {
  const r = mulberry32(seed), base = r() * 2 * Math.PI, speed = 1 + r() * 5, swing = (0.3 + r() * 0.7) * (Math.PI / 3);
  const period = 240 + r() * 240, gust = 200 + r() * 160, p1 = r() * 2 * Math.PI, p2 = r() * 2 * Math.PI;
  return (t) => ({
    toward: base + swing * Math.sin((2 * Math.PI * t) / period + p1),
    speed: Math.max(0, speed * (1 + 0.4 * Math.sin((2 * Math.PI * t) / gust + p2))),
  });
}

/** The breeze in words for the card: how hard, and whether it carries the sound to the houses. */
export function windText({ toward, speed }: Wind): string {
  if (speed < 0.5) return "Calm";
  const to = Math.cos(toward), where = to > 0.5 ? "toward the houses" : to < -0.5 ? "away from the houses" : "across the park";
  return `Wind ${speed.toFixed(0)} m/s ${where}`;
}

/** The heat map over the park and the road: only the fed speakers, the highs bent by the breeze (louder downwind of the
 * rig, quieter upwind, measured from the speakers' middle). */
export function heat(w: World, c: Cables): Grid {
  const on = playing(w, c), src = sources(w, (i) => on.has(i.key));
  const g = coverage(src, GROUND, "high"), { toward, speed } = wind(w);
  if (!speed || !src.length) return g;
  const ux = Math.sin(toward), uz = Math.cos(toward);
  const cx = src.reduce((s, o) => s + o.pos.x, 0) / src.length, cz = src.reduce((s, o) => s + o.pos.z, 0) / src.length;
  const dx = (g.x1 - g.x0) / g.nx, dz = (g.z1 - g.z0) / g.nz;
  for (let iz = 0; iz < g.nz; iz++) {
    for (let ix = 0; ix < g.nx; ix++) {
      const along = (g.x0 + (ix + 0.5) * dx - cx) * ux + (g.z0 + (iz + 0.5) * dz - cz) * uz;
      g.db[iz * g.nx + ix] += clamp(WIND_DB * speed * along, -WIND_MAX, WIND_MAX);
    }
  }
  return g;
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
  /** Hours the tank runs at this load, and the share of the day it covers, 0 to 1 (null with no generator). */
  fuel: { hours: number; day: number } | null;
  score: number;
  pass: boolean;
};

/** 60 points for the crowd at the target, 25 for the houses under the limit (5 dB over is none), 15 for clear paths,
 * all times the share of the day the fuel lasts: a tank that runs dry at 4 hours leaves the park quiet for the other 4. */
export function score(w: World, c: Cables, g: Grid = heat(w, c)): Score {
  const crowd = cellsIn(g, ZONES.crowd), houses = cellsIn(g, ZONES.houses);
  const covered = crowd.filter((d) => Math.abs(d - TARGET) <= WINDOW).length / crowd.length;
  const loudest = Math.max(...houses), live = Number.isFinite(loudest);
  const quiet = live ? clamp(1 - (loudest - SPILL_LIMIT) / 5, 0, 1) : 1;
  const crossings = hazards(w, c).length, off = tripped(w, c);
  const l = load(w, c), fuel = l && { hours: Math.round(l.hours * 10) / 10, day: Math.round(clamp(l.hours / DAY_HOURS, 0, 1) * 100) / 100 };
  const s = Math.round(covered * (60 + 25 * quiet + (crossings ? 0 : 15)) * (fuel ? clamp(l.hours / DAY_HOURS, 0, 1) : 1));
  const r1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  return { covered: Math.round(covered * 100) / 100, crowd: r1(mean(crowd)), houses: r1(loudest), hazards: crossings, tripped: off, fuel, score: s, pass: s >= PASS };
}

/** Show time: the sound as the crowd takes it, scaled by their mood (late doors cost it), and the pay. */
export function show(w: World, c: Cables) {
  const s = score(w, c), d = doors(w.level.name, w.t), total = showScore(s.score, d.mood);
  return { sound: s.score, mood: d.mood, late: Math.round(d.late), pay: d.pay, fee: d.fee, score: total, pass: total >= PASS };
}
export type Show = ReturnType<typeof show>;

/** What the harness adds for the park: the generator's load and fuel, the breeze and the score. */
export function parkState(w: World, c: Cables) {
  const l = load(w, c);
  const { toward, speed } = wind(w);
  return { generator: l && { watts: Math.round(l.watts), limit: Math.round(l.limit), warn: l.warn, trips: l.trips, litres: Math.round(l.litres * 10) / 10 }, spillLimit: SPILL_LIMIT, wind: { toward: Math.round(toward * 100) / 100, speed: Math.round(speed * 10) / 10 }, ...score(w, c) };
}
