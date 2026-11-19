// The crowd in a level: people who arrive when the doors open and stand packed against the stage, thinning to the back
// (a density field from @rustybuns/gear's crowd.ts), what they do to the sound, how they slow you down, and how they take
// it. A venue says where its crowd stands with a `CrowdSpot`; `letIn` fills it. Plain numbers, no DOM: crowd-view.ts draws them.
import { clamp } from "@rustybuns/util";
import { type CrowdField, type Room, crowdNoise, densityAt, fillFloor, headcount, reverbTime } from "@rustybuns/gear";
import type { World } from "../sim.ts";

type Rect = { x0: number; x1: number; z0: number; z1: number };

/** Where a venue's crowd stands and how its room rings. */
export type CrowdSpot = {
  /** The floor people can stand on, in cells about half a metre across. */
  floor: Rect & { nx: number; nz: number };
  /** The stage edge they pack against. */
  stageZ: number;
  /** People a square metre at the stage, where it is packed (PACKED unless the crowd stands looser, an afternoon on the grass). */
  peak?: number;
  /** How many the room holds, when the tour hasn't said how many follow you. */
  capacity: number;
  /** The room's box and surfaces; null out of doors, where nothing rings and people only stand in the sound. */
  room: Room | null;
  /** Where the people stand when it isn't one floor packed against one stage (two stages on a field, benches up a hill). */
  fill?: (people: number) => CrowdField;
  /** The parts of the crowd that react on their own, front to back. */
  regions: readonly { name: string; zone: Rect }[];
};

export type Crowd = { spot: CrowdSpot; people: number; field: CrowdField; since: number };

const crowds = new WeakMap<World, Crowd>(), tonights = new WeakMap<World, number>();

/** Tonight's crowd on this floor: what the tour said (`tour.ts` `crowd`: the house plus your following), else a full floor. */
export const comingTonight = (w: World, spot: CrowdSpot) => tonights.get(w) ?? spot.capacity;
/** The tour says how many are coming tonight. */
export const expectTonight = (w: World, people: number) => void tonights.set(w, Math.max(0, Math.round(people)));

/** The crowd in the room, or null before the doors open. */
export const crowdOf = (w: World): Crowd | null => crowds.get(w) ?? null;

/** The crowd a spot holds: `people` (the room's capacity unless given), packed from the stage back. */
export function expected(spot: CrowdSpot, people = spot.capacity): CrowdField {
  return spot.fill?.(people) ?? fillFloor(spot.floor, people, spot.stageZ, spot.peak);
}

/** Doors open: `people` (tonight's crowd unless given) walk in and take the floor; you walk slower through them. */
export function letIn(w: World, spot: CrowdSpot, people = comingTonight(w, spot)): Crowd {
  const field = expected(spot, people), c = { spot, people: Math.round(headcount(field)), field, since: w.t };
  crowds.set(w, c);
  w.underfoot = (x, z) => walkShare(densityAt(field, x, z));
  return c;
}

/** The room empties (a reload, a new night). */
export function clearCrowd(w: World) {
  crowds.delete(w);
  w.underfoot = undefined;
}

/**
 * Your walking pace through people at `rho` per m2, as a share of an open floor: Weidmann's fundamental diagram for
 * pedestrians, v = v0 (1 - exp(-1.913 (1/rho - 1/5.4))), where 5.4 per m2 stops everyone. One per m2 barely slows you,
 * two is half pace, four is a shuffle. Never under 0.15 so you can always squeeze through.
 */
export function walkShare(rho: number): number {
  if (rho <= 0.05) return 1;
  return clamp(1 - Math.exp(-1.913 * (1 / rho - 1 / 5.4)), 0.15, 1);
}

/** How a crowd of `people` is drawn with at most `max` figures: how many heads each figure stands for (1 in a small room). */
export const drawn = (people: number, max: number): { figures: number; heads: number } => {
  const heads = Math.max(1, people / max);
  return { figures: Math.round(people / heads), heads };
};

/** Seconds from doors to a full room in the picture: people come in the door and fill from the front. */
export const ARRIVE = 12;
/** How much of the crowd has walked in by now, 0 to 1. */
export const arrived = (w: World, c: Crowd) => clamp((w.t - c.since) / ARRIVE, 0, 1);

/** The room's reverb time (mids and bass, s; null out of doors) and the crowd's own noise, with `people` in. */
export function roomWith(spot: CrowdSpot, people: number) {
  const r1 = (v: number) => Math.round(v * 100) / 100, room = spot.room;
  return { people, rt60: room && r1(reverbTime(room, people)), rt60Low: room && r1(reverbTime(room, people, 125)), noise: Math.round(crowdNoise(people)) };
}

/** A level whose score doesn't hear its crowd still says who is in: how many came and are expected, and the room empty and with them in. */
export function house(w: World, spot: CrowdSpot) {
  const c = crowdOf(w), coming = comingTonight(w, spot);
  return { in: !!c, count: c?.people ?? 0, expected: coming, empty: roomWith(spot, 0), full: roomWith(spot, c?.people ?? coming) };
}

/** Too loud at the front from here up, dB SPL: people step back from the stack past about 103 dB (long-show exposure). */
export const TOO_LOUD = 103;

export type Doing = "dancing" | "drifting forward" | "leaving" | "thinning";
export type Mood = { name: string; people: number; density: number; soundcheck: number | null; full: number | null; mood: number; doing: Doing };

/**
 * How a region takes the sound: within the window of the target and they stay and dance (mood near 100); too quiet and
 * they drift forward, much too quiet and they leave; over `tooLoud` (TOO_LOUD, or the top of a big room's window where
 * its target sits higher) and the front thins.
 */
export function moodOf(db: number | null, target: number, window: number, tooLoud = TOO_LOUD): { mood: number; doing: Doing } {
  if (db === null || !Number.isFinite(db)) return { mood: 0, doing: "leaving" };
  if (db > tooLoud) return { mood: Math.round(clamp(100 - 12 * (db - tooLoud), 0, 100)), doing: "thinning" };
  const short = target - window - db;
  if (short <= 0) return { mood: Math.round(clamp(100 - 4 * Math.max(0, Math.abs(db - target) - window / 2), 60, 100)), doing: "dancing" };
  return { mood: Math.round(clamp(80 - 10 * short, 0, 80)), doing: short > 6 ? "leaving" : "drifting forward" };
}

/** Every region's people, the dB it hears at soundcheck and full (from `levels`), and its mood. */
export function regions(c: Crowd, levels: (zone: Rect) => { soundcheck: number | null; full: number | null }, target: number, window: number, tooLoud = TOO_LOUD): Mood[] {
  const f = c.field, cell = ((f.x1 - f.x0) / f.nx) * ((f.z1 - f.z0) / f.nz);
  return c.spot.regions.map(({ name, zone }) => {
    let n = 0, cells = 0;
    for (let iz = 0; iz < f.nz; iz++) for (let ix = 0; ix < f.nx; ix++) {
      const x = f.x0 + ((ix + 0.5) * (f.x1 - f.x0)) / f.nx, z = f.z0 + ((iz + 0.5) * (f.z1 - f.z0)) / f.nz;
      if (x >= zone.x0 && x <= zone.x1 && z >= zone.z0 && z <= zone.z1) { n += f.density[iz * f.nx + ix]! * cell; cells++; }
    }
    const db = levels(zone);
    return { name, people: Math.round(n), density: Math.round((n / Math.max(1, cells * cell)) * 10) / 10, ...db, ...moodOf(db.full, target, window, tooLoud) };
  });
}
