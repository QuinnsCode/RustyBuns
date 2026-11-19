// The crowd in a level: people who arrive when the doors open and stand packed against the stage, thinning to the back
// (a density field from @rustybuns/gear's crowd.ts), what they do to the sound, how they slow you down, and how they take
// it. A venue says where its crowd stands with a `CrowdSpot`; `letIn` fills it. Plain numbers, no DOM: crowd-view.ts draws them.
import { clamp } from "@rustybuns/util";
import { type CrowdField, type Room, PACKED, crowdNoise, densityAt, fillFloor, headcount, reverbTime } from "@rustybuns/gear";
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

/** The crowd in the room: `moved` is when it last moved on its mood (or when everyone is in), `moves` how many times it has. */
export type Crowd = { spot: CrowdSpot; people: number; field: CrowdField; since: number; moved: number; moves: number };

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
  return stand(w, { spot, people: 0, field: expected(spot, people), since: w.t, moved: w.t + ARRIVE, moves: 0 });
}

/** Put a crowd on the floor: its headcount from its field, and your pace through it. */
function stand(w: World, c: Crowd): Crowd {
  const field = c.field, next = { ...c, people: Math.round(headcount(field)) };
  crowds.set(w, next);
  w.underfoot = (x, z) => walkShare(densityAt(field, x, z));
  return next;
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

/** The room as it rings now: empty before the doors, then tightening as people walk in. */
export function ringing(w: World, spot: CrowdSpot) {
  const c = crowdOf(w);
  return roomWith(spot, c && c.spot === spot ? Math.round(c.people * arrived(w, c)) : 0);
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

/** Seconds between the crowd's moves once everyone is in. */
export const MOVE_EVERY = 4;
/** The share of a region that moves on each step: forward when too quiet, back when too loud, out of the door when leaving. */
export const MOVE_SHARE = 0.25;

/** The cells of each region, front to back: a cell goes with the region it sits in, or the nearest (the strip by the door moves with the back). */
function regionCells(c: Crowd): number[][] {
  const f = c.field, out = c.spot.regions.map((): number[] => []);
  const gap = (v: number, a: number, b: number) => Math.max(0, a - v, v - b);
  for (let iz = 0; iz < f.nz; iz++) for (let ix = 0; ix < f.nx; ix++) {
    const x = f.x0 + ((ix + 0.5) * (f.x1 - f.x0)) / f.nx, z = f.z0 + ((iz + 0.5) * (f.z1 - f.z0)) / f.nz;
    let best = 0, near = Infinity;
    c.spot.regions.forEach(({ zone }, r) => { const d = Math.hypot(gap(x, zone.x0, zone.x1), gap(z, zone.z0, zone.z1)); if (d < near) { near = d; best = r; } });
    out[best]?.push(iz * f.nx + ix);
  }
  return out;
}

/**
 * The crowd moves on its mood, every MOVE_EVERY seconds once everyone is in: a region drifting forward sends a share of
 * its people one region nearer the stage, a thinning one sends them one back (out of the door from the back), a leaving
 * one sends them home. Nobody packs past the spot's peak (PACKED) a square metre: who can't fit stays where they were. `moods` are
 * `regions()`, front to back. Returns the crowd as it stands now (a new one when it moved).
 */
export function move(w: World, moods: readonly Pick<Mood, "doing">[]): Crowd | null {
  const c = crowdOf(w);
  if (!c || w.t < c.moved + MOVE_EVERY) return c;
  const f = c.field, d = Float32Array.from(f.density), cell = ((f.x1 - f.x0) / f.nx) * ((f.z1 - f.z0) / f.nz), cells = regionCells(c);
  const count = (ks: number[]) => ks.reduce((n, k) => n + d[k]! * cell, 0);
  /** Take `n` people out of a region, evenly over its cells. */
  const take = (ks: number[], n: number) => { const have = count(ks); if (have > 0) for (const k of ks) d[k] = d[k]! * (1 - Math.min(1, n / have)); };
  /** Stand up to `n` people in a region where there is room, in proportion to the room in each cell; how many fit. */
  const add = (ks: number[], n: number) => {
    const room = ks.map((k) => Math.max(0, (c.spot.peak ?? PACKED) - d[k]!) * cell), free = room.reduce((a, b) => a + b, 0), fit = Math.min(n, free);
    if (fit > 0) ks.forEach((k, j) => { d[k] = d[k]! + (fit * room[j]!) / free / cell; });
    return fit;
  };
  moods.forEach(({ doing }, r) => {
    const from = cells[r];
    if (!from || doing === "dancing") return;
    const to = doing === "drifting forward" ? cells[r - 1] : doing === "thinning" ? cells[r + 1] : undefined;
    if (doing === "drifting forward" && !to) return; // already at the stage
    const n = count(from) * MOVE_SHARE;
    take(from, n);
    if (to) add(from, n - add(to, n)); // who doesn't fit stays
  });
  return stand(w, { ...c, field: { ...f, density: d }, moved: w.t, moves: c.moves + 1 });
}
