// Desert Gathering: out past the end of the road under a full moon, where the sound-system crew stacks a wall of
// speakers and the dancing goes until sunrise. The truck stops at the end of the track and everything walks 30 m over
// sand (every step slower); the generator's small wheels dig in, so it rides the sand cart on its balloon tyres. The
// wall is four horn-loaded dance stacks (a 115 kg 21" bin, a mid-bass horn, a mid-high horn: 235 kg, past any lift),
// each strapped on a sand dolly at the tail lift and pushed into place; line the bins up so they sum on the dance floor
// (spread or staggered, they cancel in places), keep the mid-highs up over the heads (the floor is scored with the
// night's peak crowd on it, and bodies soak up the highs), and keep the spill off the camp. The night is twelve hours: the
// fuel in the generator and the jerry cans set down by it (or poured in) have to last until the sun comes up, and the score is how much of
// the night the wall played. On the tri-amp rig the amps' crossover can be set too (#6473, @rustybuns/gear's lesson:
// the same one Qollab Studio teaches), and one left wrong costs sound. Plain data, no DOM; the page (desert-view.ts) draws it.
import { clamp } from "@rustybuns/util";
import { type Area, type CrowdField, type Grid, type System, type SystemId, SYSTEM_IDS, SYSTEMS, coverage, passive, coverageThrough, gear as catalog, runHours, stackWidth, system } from "@rustybuns/gear";
import { crossoverCheck, rigCrossover, type ChannelDsp } from "@rustybuns/gear/crossover";
import { LESSON_RIG, SUB_AHEAD_M, lessonStart } from "@rustybuns/gear/crossover-lesson";
import { type Level, type World } from "../sim.ts";
import { doors, showScore } from "../clock.ts";
import { type Cables, jacks } from "../cables/cables.ts";
import { type Zone, cellsIn, mean, sources } from "./dive-bar.ts";
import { load, playing, tripped } from "./park.ts";
import { comingTonight, crowdOf, type CrowdSpot, expected } from "../crowd/crowd.ts";

/** Where the four stacks come off the tail lift, each strapped on its dolly: x along the truck's end. */
const STACK_X = [-2.0, -3.4, -4.8, -6.2];
/** Stack `n` on its sand dolly at (x, z), bottom to top as `rig` builds one (the horn stack: the 21" horn bin on the
 * board, the mid-bass horn on the bin, the mid-high horn on top, its mouth at about 2 m, over the heads of a full floor).
 * Keyed by part: `dolly-n`, `bin-n` (the lowest box), `midbass-n` (any between), `top-n`. A rig whose stack comes
 * without a dolly rides one anyway: nobody carries a 214 kg sub across sand. */
function stackAt(n: number, x: number, z: number, rig: System = SYSTEMS["dance-stack"]) {
  const ids = rig.stack[0] === "sand-dolly" ? rig.stack : ["sand-dolly", ...rig.stack];
  let y = 0;
  return ids.map((id, i) => {
    const part = i === 0 ? "dolly" : i === 1 ? "bin" : i === ids.length - 1 ? "top" : "midbass";
    const item = { key: `${part}-${n}`, gear: id, x, y, z, rot: 0 };
    y += catalog(id).size.h;
    return item;
  });
}
/** The stacks as they come off the tail lift. */
const STACK_Z = 31.3;

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
    ...STACK_X.flatMap((x, n) => stackAt(n + 1, x, STACK_Z)),
    { key: "rack-bins", gear: "amp-rack-4u", x: -8.0, y: 0, z: 31.4, rot: 0 },
    { key: "rack-tops", gear: "amp-rack-4u", x: -8.8, y: 0, z: 31.4, rot: 0 },
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
    ...Array.from({ length: 12 }, (_, n) => ({ key: `speaker-${n + 1}`, kind: "speaker" as const, lengthM: 5 })),
  ],
};

/**
 * Tonight's rig (`?rig=` on the page): the four stacks off the truck become another of the open-air rigs
 * (@rustybuns/gear systems.ts: synergy horns over tapped horns, the sculpted array on triple 21s, the tri-amp stack),
 * each heard by its own boxes' sheets. Before the world is made; the rig's id, the horn stack for anything unknown.
 */
let tonight: SystemId = "dance-stack";
/** The rig on the truck tonight. */
export const tonightRig = (): SystemId => tonight;
/** The rigs the desert's truck can bring: the passive ones, fed from the amp racks it carries (a powered rig wants a
 *  mains feed and a signal line to every box, more than the case holds). */
export const DESERT_RIGS = SYSTEM_IDS.filter((id) => passive(SYSTEMS[id]));
export function bringRig(id: string | null): string {
  const rig = system(DESERT_RIGS.find((r) => r === id) ?? null);
  tonight = rig.id;
  const gap = Math.max(STACK_X[0]! - STACK_X[1]!, stackWidth(rig) + 0.1);
  DESERT.items = [...DESERT.items.filter((i) => !/^(dolly|bin|midbass|top)-\d$/.test(i.key)), ...STACK_X.flatMap((_, n) => stackAt(n + 1, STACK_X[0]! - n * gap, STACK_Z, rig))];
  return rig.id;
}

/** Tonight's amp crossovers, by world: none until you open the amps' DSP, and the racks play their preset. */
const amps = new WeakMap<World, { bands: readonly ChannelDsp[]; subAheadM: number }>();
const presetOf = () => rigCrossover(tonight).map((b) => b.dsp);
/** The amps' DSP as it is set, and how far the sub stands in front of the tops (0 till it's opened). */
export const ampCrossover = (w: World) => amps.get(w) ?? { bands: presetOf(), subAheadM: 0 };
/** Open the amps' DSP for the lesson: on the tri-amp stack it is found set wrong, with the sub out in front. Opened
 *  again, it is as you left it. */
export function openCrossover(w: World): { ok: true } | { ok: false; why: string } {
  if (tonight !== LESSON_RIG) return { ok: false, why: "bring the tri-amp stack to set a crossover by hand (?rig=tri-amp)" };
  if (!amps.has(w)) amps.set(w, { bands: lessonStart(), subAheadM: SUB_AHEAD_M });
  return { ok: true };
}
/** Set the amps' bands (once opened). */
export function setAmpCrossover(w: World, bands: readonly ChannelDsp[]) {
  const a = amps.get(w);
  if (a) amps.set(w, { ...a, bands });
}
/** Back to the maker's preset, the sub back in line. */
export function resetAmpCrossover(w: World) {
  if (amps.has(w)) amps.set(w, { bands: presetOf(), subAheadM: 0 });
}
/** What a crossover left wrong takes off the sound: its worst hole or bump past 1 dB, and 5 for each driver in danger. */
const CROSSOVER_MOST = 30;
export function crossoverCost(w: World): number {
  const a = amps.get(w);
  if (!a) return 0;
  const preset = rigCrossover(tonight), c = crossoverCheck(preset.map((b, i) => ({ ...b, dsp: a.bands[i] ?? b.dsp })), presetOf(), a.subAheadM);
  const off = Math.max(-c.dipDb, c.bumpDb);
  return Math.min(CROSSOVER_MOST, Math.round(off > 1 ? off : 0) + 5 * c.warnings.length);
}

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
  room: null,
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
/** The bass the floor should feel at 63 Hz, dB: at least this everywhere on it. A horn wall's night, 13 dB over the mids. */
export const BASS = 115;
/** The camp's limit, mids and highs at the loudest tent, dB; 3 dB over it is no camp points at all. */
export const CAMP_LIMIT = 85;
export const PASS = 85;
/** The night: doors at six in the evening, sunrise at six in the morning. */
export const NIGHT_HOURS = 12, DUSK = 18;
/** Fuel within this of the generator is there for the crew to top it up through the night, metres. */
export const FUEL_REACH = 2.5;

/** The desert, the camp and the track, at ear height, in 1 m cells. */
export const GROUND: Area = { x0: -16, x1: 32, z0: -6, z1: 34, y: 1.6, nx: 48, nz: 40 };

/** The floor at the peak of the night, just before sunrise: everyone who is coming, packed toward the wall (the crowd
 * that is in, once it is). The wall is judged by how it sounds to them, not to an empty desert at dusk. */
export const peakCrowd = (w: World): CrowdField => crowdOf(w)?.field ?? expected(DANCE_FLOOR, comingTonight(w, DANCE_FLOOR));

/** The heat map over the sand: only the fed speakers. Mids and highs as heard through the night's peak crowd at 2 kHz
 * (`crowd` null for the empty desert), or (`low`) the bins' 63 Hz, which bodies don't stop. */
export function heat(w: World, c: Cables, band: "high" | "low" = "high", crowd: CrowdField | null = peakCrowd(w)): Grid {
  const on = playing(w, c), s = sources(w, (i) => on.has(i.key));
  return band === "low" ? coverage(s, GROUND, "low") : coverageThrough(s, crowd, GROUND, 2000);
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

/**
 * The generator's own noise. A 7 kVA open-frame petrol set is about 74 dB(A) at 7 m (a sound power near 97 dB(A),
 * typical of its class's spec sheets), and outdoors it falls 6 dB for each doubling of distance. Under GEN_QUIET at
 * the dance floor it is lost under a crowd's talk between tracks; over it, it is the drone in every breakdown.
 */
export const GEN_DB_AT_7M = 74, GEN_QUIET = 60;
/** The generator's level at the nearest edge of the dance floor, dB(A) (null with no generator, or when it is not running). */
export function generatorAtFloor(w: World, c: Cables): number | null {
  const gen = w.items.find((i) => catalog(i.gear).generator);
  if (!gen || !(load(w, c)?.watts ?? 0)) return null;
  const f = ZONES.floor, d = Math.hypot(gen.x - clamp(gen.x, f.x0, f.x1), gen.z - clamp(gen.z, f.z0, f.z1));
  return Math.round((GEN_DB_AT_7M - 20 * Math.log10(Math.max(1, d) / 7)) * 10) / 10;
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
  /** Share of the floor within SPREAD dB of TARGET with the night's peak crowd on it, 0 to 1. */
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
  /** What the amps' crossover takes off the sound (0 at its preset). */
  crossover: number;
  /** The sound: 40 for the floor at the target, 30 for the bass, 30 for a quiet camp, less DUST_COST for each dusty joint
   *  and what the crossover costs. */
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
  const grit = dusty(w, c), xo = crossoverCost(w);
  const sound = covered === 0 && bass === 0 ? 0 : Math.max(0, Math.round(40 * covered + 30 * bass + 30 * quiet) - Math.min(DUST_MOST, DUST_COST * grit.length) - xo);
  const f = fuel(w, c), off = tripped(w, c), hours = off || !f ? 0 : Math.min(NIGHT_HOURS, f.hours), night = hours / NIGHT_HOURS;
  const s = Math.round(sound * night), r1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  return {
    covered: Math.round(covered * 100) / 100, bass: Math.round(bass * 100) / 100,
    floor: r1(mean(floor)), bassLow: Math.min(...bassCells) > 0 ? r1(Math.min(...bassCells)) : null, camp: r1(loudest),
    hours: Math.round(hours * 10) / 10, until: clockAt(hours), sunrise: hours >= NIGHT_HOURS, tripped: off, dusty: grit, crossover: xo,
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
    crowd: crowdOf(w)?.people ?? null,
    /** The generator's own noise at the nearest edge of the dance floor, dB(A): keep it under GEN_QUIET. */
    generatorDb: generatorAtFloor(w, c) };
}
