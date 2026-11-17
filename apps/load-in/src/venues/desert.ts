// The desert night party: out past the end of the road under a full moon, where the sound-system crew stacks a wall of
// speakers and the dancing goes until sunrise. The truck stops at the end of the track and everything walks 30 m over
// sand (every step slower); the generator's small wheels dig in, so it rides the sand cart on its balloon tyres. Stack
// the wall from four 18" bins and four 15" tops off two amp racks, line the bins up so they sum on the dance floor
// (spread or staggered, they cancel in places), and keep the spill off the camp. The night is twelve hours: the
// fuel in the generator and the jerry cans set down by it (or poured in) have to last until the sun comes up, and the score is how much of
// the night the wall played. Plain data, no DOM; the page (desert-view.ts) draws it.
import { clamp } from "@rustybuns/util";
import { type Area, type Grid, coverage, gear as catalog, runHours } from "@rustybuns/gear";
import { type Level, type World } from "../sim.ts";
import { doors, showScore } from "../clock.ts";
import { type Cables, jacks } from "../cables/cables.ts";
import { type Zone, cellsIn, mean, sources } from "./dive-bar.ts";
import { load, playing, tripped } from "./park.ts";
import { crowdOf, type CrowdSpot } from "../crowd/crowd.ts";

export const DESERT: Level = {
  name: "desert",
  outdoor: true,
  ground: "sand",
  bounds: { x0: -16, x1: 16, z0: 0.3, z1: 40.75 },
  room: { x0: -16, x1: 16, z0: 0, z1: 34, height: 0, door: 0 },
  outlets: [],
  start: { x: 0, z: 33.5, yaw: 0 },
  truck: { x0: -1.3, x1: 1.3, z0: 34.6, z1: 41, h: 2.4 },
  // Off the truck's tail at the end of the track: the generator already up on the cart, then the wall in pieces.
  items: [
    { key: "cart", gear: "sand-cart", x: 0, y: 0, z: 31.6, rot: 0 },
    { key: "generator", gear: "generator-7kva", x: 0, y: 0.45, z: 31.6, rot: 0, litres: 15 },
    ...[-4.6, -3.9, -3.2, -2.5].map((x, n) => ({ key: `bin-${n + 1}`, gear: "sub-18", x, y: 0, z: 31.4, rot: 0 })),
    ...[2.4, 3.0, 3.6, 4.2].map((x, n) => ({ key: `top-${n + 1}`, gear: "top-15-passive", x, y: 0, z: 31.4, rot: 0 })),
    { key: "rack-bins", gear: "amp-rack-4u", x: -6.2, y: 0, z: 31.4, rot: 0 },
    { key: "rack-tops", gear: "amp-rack-4u", x: -7.0, y: 0, z: 31.4, rot: 0 },
    { key: "distro", gear: "distro-box", x: 5.2, y: 0, z: 31.4, rot: 0 },
    { key: "case", gear: "road-case-m", x: 6.0, y: 0, z: 31.4, rot: 0 },
    { key: "mixer", gear: "mixer-small", x: 6.0, y: 0.5, z: 31.4, rot: 0 },
    { key: "can-1", gear: "jerry-can-20l", x: 6.8, y: 0, z: 31.4, rot: 0, litres: 20 },
    { key: "can-2", gear: "jerry-can-20l", x: 7.3, y: 0, z: 31.4, rot: 0, litres: 20 },
  ],
  // The generator sits well back from the dance floor, so a long feed; speaker cable to each stack and its neighbour.
  caseLoad: [
    { key: "power-25", kind: "power", lengthM: 25 },
    { key: "power-5a", kind: "power", lengthM: 5 },
    { key: "power-5b", kind: "power", lengthM: 5 },
    { key: "power-5c", kind: "power", lengthM: 5 },
    ...[1, 2, 3, 4].map((n) => ({ key: `xlr-${n}`, kind: "xlr" as const, lengthM: 10 })),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ key: `speaker-${n}`, kind: "speaker" as const, lengthM: 5 })),
  ],
};

/** Where things are: the dance floor in front of the wall and the crew's camp off to the right. */
export const ZONES = {
  floor: { x0: -7, x1: 7, z0: 6, z1: 20 },
  /** The tents out front and to the right, where people sleep before their shift: in the right-hand tops' spill. */
  camp: { x0: 20, x1: 30, z0: 8, z1: 18 },
} satisfies Record<string, Zone>;

/**
 * The dance floor's crowd: up to 500 on its 14 by 14 m (2.5 a square metre at the peak of the night), packed toward
 * the wall. Open desert, so the "room" is all absorption: people change no reverb here, they only stand in the sound.
 */
export const DANCE_FLOOR: CrowdSpot = {
  floor: { ...ZONES.floor, nx: 14, nz: 14 },
  stageZ: ZONES.floor.z0 - 0.5,
  capacity: 500,
  room: { w: 200, d: 200, h: 100, alpha: 1 },
  regions: [
    { name: "front", zone: { ...ZONES.floor, z1: 10.5 } },
    { name: "middle", zone: { ...ZONES.floor, z0: 10.5, z1: 15.5 } },
    { name: "back", zone: { ...ZONES.floor, z0: 15.5 } },
  ],
};

/** Mids and highs on the floor, dB SPL: loud, a sound system's night, not a club's. */
export const TARGET = 102;
/** Within this many dB of the target counts: a dance floor 14 m deep in front of one wall can't be even to 4. */
export const SPREAD = 6;
/** The bass the floor should feel at 63 Hz, dB: at least this everywhere on it. */
export const BASS = 108;
/** The camp's limit, mids and highs at the loudest tent, dB; 3 dB over it is no camp points at all. */
export const CAMP_LIMIT = 85;
export const PASS = 85;
/** The night: doors at six in the evening, sunrise at six in the morning. */
export const NIGHT_HOURS = 12, DUSK = 18;
/** Fuel within this of the generator is there for the crew to top it up through the night, metres. */
export const FUEL_REACH = 2.5;

/** The desert, the camp and the track, at ear height, in 1 m cells. */
export const GROUND: Area = { x0: -16, x1: 32, z0: -6, z1: 34, y: 1.6, nx: 48, nz: 40 };

/** The heat map over the sand: only the fed speakers, mids and highs or (`low`) the bins' 63 Hz. */
export function heat(w: World, c: Cables, band: "high" | "low" = "high"): Grid {
  const on = playing(w, c);
  return coverage(sources(w, (i) => on.has(i.key)), GROUND, band);
}

/** The fuel for the night: what is in the generator's tank (poured in, or as it came off the truck) and in every jerry can
 * set down by it for the crew to top it up, and how long that runs it at the wall's draw. */
export function fuel(w: World, c: Cables) {
  const gen = w.items.find((i) => catalog(i.gear).generator);
  if (!gen) return null;
  const cans = w.items.filter((i) => catalog(i.gear).can && (i.litres ?? 0) > 0 && i.key !== w.held?.key && Math.hypot(i.x - gen.x, i.z - gen.z) <= FUEL_REACH);
  const litres = (gen.litres ?? 0) + cans.reduce((s, i) => s + (i.litres ?? 0), 0);
  const watts = load(w, c)?.watts ?? 0;
  return { litres, cans: cans.length, watts: Math.round(watts), hours: Math.round(runHours(gen.gear, watts, litres) * 10) / 10 };
}

/** A connector this close to the sand (metres) fills with dust in a night of wind, and each one that does costs this much of the sound. */
export const DUST_LOW = 0.2, DUST_COST = 4, DUST_MOST = 20;
const wraps = new WeakMap<Cables, Set<string>>();
/** Wrap a plugged joint against the dust (a turn of tape or a bag round it), or unwrap it: `owner` and its `jack`. */
export function wrap(c: Cables, owner: string, jack: string, on = true): { ok: true } | { ok: false; why: string } {
  if (!c.runs.some((r) => [r.a, r.b].some((e) => "plug" in e && e.plug[0] === owner && e.plug[1] === jack))) return { ok: false, why: `nothing is plugged into ${owner} ${jack}` };
  const set = wraps.get(c) ?? new Set<string>();
  wraps.set(c, set);
  if (on) set.add(`${owner} ${jack}`); else set.delete(`${owner} ${jack}`);
  return { ok: true };
}
/**
 * The joints the dust gets into by sunrise: every plugged connector within DUST_LOW of the sand that is not wrapped.
 * Each one crackles and drops out through the night. The cure is the crew's: lift the gear off the sand (stand it on a
 * case, a bin or the cart) or wrap the joint.
 */
export function dusty(w: World, c: Cables): string[] {
  const wrapped = wraps.get(c), at = new Map(jacks(w).map((j) => [`${j.owner} ${j.jack}`, j.at.y]));
  const out = new Set<string>();
  for (const r of c.runs) for (const e of [r.a, r.b]) {
    if (!("plug" in e)) continue;
    const name = `${e.plug[0]} ${e.plug[1]}`, y = at.get(name);
    if (y !== undefined && y < DUST_LOW && !wrapped?.has(name)) out.add(name);
  }
  return [...out].sort();
}

/** Tape every dusty joint within `reach` metres of where you stand (the G key, for gaffer tape); how many it wrapped. */
export function wrapNear(w: World, c: Cables, reach = 2): number {
  const near = new Set(jacks(w).filter((j) => Math.hypot(j.at.x - w.you.x, j.at.z - w.you.z) <= reach).map((j) => `${j.owner} ${j.jack}`));
  const todo = dusty(w, c).filter((name) => near.has(name));
  for (const name of todo) { const cut = name.lastIndexOf(" "); wrap(c, name.slice(0, cut), name.slice(cut + 1)); }
  return todo.length;
}

/** The clock at `hours` into the night, "05:38". */
export const clockAt = (hours: number) => {
  const m = Math.round((DUSK + hours) * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export type Score = {
  /** Share of the floor within SPREAD dB of TARGET, 0 to 1. */
  covered: number;
  /** Share of the floor with BASS dB or more at 63 Hz: lined-up bins sum, spread or staggered ones cancel in places. */
  bass: number;
  floor: number | null;
  /** The weakest bass on the floor, dB. */
  bassLow: number | null;
  /** Mids and highs at the loudest tent, dB. */
  camp: number | null;
  /** Hours the fuel runs the wall at show level, and the time it runs out (or sunrise). */
  hours: number;
  until: string;
  sunrise: boolean;
  tripped: boolean;
  /** The plugged joints the dust gets into by sunrise (`owner jack`): each crackles through the night. */
  dusty: string[];
  /** The sound: 40 for the floor at the target, 30 for the bass, 30 for a quiet camp, less DUST_COST for each dusty joint. */
  sound: number;
  /** The sound times the share of the night it played. */
  score: number;
  /** A score of PASS and the wall still playing when the sun comes up. */
  pass: boolean;
};

export function score(w: World, c: Cables, high: Grid = heat(w, c), low: Grid = heat(w, c, "low")): Score {
  const floor = cellsIn(high, ZONES.floor), bassCells = cellsIn(low, ZONES.floor), camp = cellsIn(high, ZONES.camp);
  const covered = floor.filter((d) => Math.abs(d - TARGET) <= SPREAD).length / floor.length;
  const bass = bassCells.filter((d) => d >= BASS).length / bassCells.length;
  const loudest = Math.max(...camp), quiet = Number.isFinite(loudest) ? clamp(1 - (loudest - CAMP_LIMIT) / 3, 0, 1) : 1;
  const grit = dusty(w, c);
  const sound = covered === 0 && bass === 0 ? 0 : Math.max(0, Math.round(40 * covered + 30 * bass + 30 * quiet) - Math.min(DUST_MOST, DUST_COST * grit.length));
  const f = fuel(w, c), off = tripped(w, c), hours = off || !f ? 0 : Math.min(NIGHT_HOURS, f.hours), night = hours / NIGHT_HOURS;
  const s = Math.round(sound * night), r1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  return {
    covered: Math.round(covered * 100) / 100, bass: Math.round(bass * 100) / 100,
    floor: r1(mean(floor)), bassLow: Math.min(...bassCells) > 0 ? r1(Math.min(...bassCells)) : null, camp: r1(loudest),
    hours: Math.round(hours * 10) / 10, until: clockAt(hours), sunrise: hours >= NIGHT_HOURS, tripped: off, dusty: grit,
    sound, score: s, pass: s >= PASS && hours >= NIGHT_HOURS,
  };
}

/** Show time: the night as the crowd takes it, scaled by their mood (a late start costs it), and the pay. */
export function show(w: World, c: Cables) {
  const s = score(w, c), d = doors(w.level.name, w.t), total = showScore(s.score, d.mood);
  return { sound: s.sound, night: s.hours, until: s.until, sunrise: s.sunrise, mood: d.mood, late: Math.round(d.late), pay: d.pay, fee: d.fee, score: total, pass: total >= PASS && s.sunrise };
}
export type Show = ReturnType<typeof show>;

/** What the harness adds for the desert: the generator's load, the fuel and the score. */
export function desertState(w: World, c: Cables) {
  const l = load(w, c);
  return { generator: l && { watts: Math.round(l.watts), limit: Math.round(l.limit), warn: l.warn, trips: l.trips }, fuel: fuel(w, c), campLimit: CAMP_LIMIT, ...score(w, c),
    /** People on the dance floor once the night has started (null before show time). */
    crowd: crowdOf(w)?.people ?? null };
}
