// How loud a speaker is at a point, how several add up, and a grid of it over a floor.
// Coordinates are metres with y up (three.js); a speaker with yaw 0 and pitch 0 faces +z.

import { gear, type SpeakerSpec } from "./catalog.ts";

export type Vec3 = { x: number; y: number; z: number };

/** A speaker placed in the room. */
export type Source = {
  speaker: SpeakerSpec;
  pos: Vec3;
  /** Turn left/right in radians; 0 faces +z, positive turns toward +x. */
  yaw: number;
  /** Tilt in radians; positive aims up. */
  pitch: number;
  /** Watts driving it; the rated watts if left out. */
  watts?: number;
  /** Delay in milliseconds (subs: how a power alley is steered). */
  delayMs?: number;
  /** Polarity flipped. */
  invert?: boolean;
};

/** "low" is the sub band, summed with phase at one frequency; "high" is mids and highs, summed as power. */
export type Band = "low" | "high";

/** Speed of sound in air at about 20 C, m/s. */
export const SPEED_OF_SOUND = 343;

/** The closest a level is figured from, so standing on a speaker isn't infinitely loud. */
const MIN_DISTANCE = 0.3;

/** Place a catalog speaker by id. */
export function source(id: string, pos: Vec3, opts: Partial<Omit<Source, "speaker" | "pos">> = {}): Source {
  const speaker = gear(id).speaker;
  if (!speaker) throw new Error(`${id} is not a speaker`);
  return { ...opts, speaker, pos, yaw: opts.yaw ?? 0, pitch: opts.pitch ?? 0 };
}

/** Level at 1 m on axis for the watts given: sensitivity + 10 log10(W), never past max SPL. */
export function levelAt1m(s: SpeakerSpec, watts = s.ratedWatts): number {
  return Math.min(s.sensitivity + 10 * Math.log10(Math.max(watts, 1e-9)), s.maxSpl);
}

/** dB lost at an angle off axis (radians, horizontal and vertical): 6 dB at the coverage edge, smooth, capped at the rear loss. */
export function offAxisLoss(s: SpeakerSpec, h: number, v: number): number {
  const eh = ((s.coverage.h / 2) * Math.PI) / 180;
  const ev = ((s.coverage.v / 2) * Math.PI) / 180;
  return Math.min(s.rearLoss, 6 * ((h / eh) ** 2 + (v / ev) ** 2));
}

/** Angles from a source's axis to a point (radians) and the distance (metres). */
export function aimTo(src: Source, p: Vec3): { h: number; v: number; d: number } {
  const dx = p.x - src.pos.x;
  const dy = p.y - src.pos.y;
  const dz = p.z - src.pos.z;
  const cy = Math.cos(src.yaw);
  const sy = Math.sin(src.yaw);
  const x1 = dx * cy - dz * sy;
  const z1 = dx * sy + dz * cy;
  const cp = Math.cos(src.pitch);
  const sp = Math.sin(src.pitch);
  const y2 = dy * cp - z1 * sp;
  const z2 = dy * sp + z1 * cp;
  return { h: Math.atan2(x1, z2), v: Math.atan2(y2, Math.hypot(x1, z2)), d: Math.hypot(dx, dy, dz) };
}

/** dB SPL from one source at a point: level at 1 m - 20 log10(d) - off-axis loss. */
export function splAt(src: Source, p: Vec3): number {
  const { h, v, d } = aimTo(src, p);
  return levelAt1m(src.speaker, src.watts) - 20 * Math.log10(Math.max(d, MIN_DISTANCE)) - offAxisLoss(src.speaker, h, v);
}

/** Levels added as power (mids and highs, or sources that don't line up in phase): two equal ones make +3 dB. */
export function sumPower(levels: readonly number[]): number {
  let p = 0;
  for (const l of levels) p += 10 ** (l / 10);
  return 10 * Math.log10(p);
}

/** Levels added with phase (radians): two equal ones in phase make +6 dB, half a cycle apart they cancel. */
export function sumCoherent(parts: readonly { db: number; phase: number }[]): number {
  let re = 0;
  let im = 0;
  for (const { db, phase } of parts) {
    const a = 10 ** (db / 20);
    re += a * Math.cos(phase);
    im += a * Math.sin(phase);
  }
  return 20 * Math.log10(Math.max(Math.hypot(re, im), 1e-12));
}

/** Whether a source plays in a band at that frequency. */
function plays(s: SpeakerSpec, band: Band, freq: number): boolean {
  return band === "low" ? s.lowCut <= freq && freq <= s.highCut : s.highCut > 500;
}

/** Level at a point from every source playing the band: "high" by power, "low" with phase at `freq` Hz. */
export function levelAt(sources: readonly Source[], p: Vec3, band: Band, freq = 63): number {
  const playing = sources.filter((s) => plays(s.speaker, band, freq));
  if (band === "high") return sumPower(playing.map((s) => splAt(s, p)));
  const k = (2 * Math.PI * freq) / SPEED_OF_SOUND;
  return sumCoherent(
    playing.map((s) => ({
      db: splAt(s, p),
      phase: -k * Math.hypot(p.x - s.pos.x, p.y - s.pos.y, p.z - s.pos.z) - 2 * Math.PI * freq * ((s.delayMs ?? 0) / 1000) + (s.invert ? Math.PI : 0),
    })),
  );
}

/** A floor to map: x and z from corner to corner at ear height `y`, sampled `nx` by `nz` at cell centres. */
export type Area = { x0: number; z0: number; x1: number; z1: number; y: number; nx: number; nz: number };

/** dB at each cell, row by row along z (`db[iz * nx + ix]`). */
export type Grid = Area & { db: Float32Array };

/** The coverage map: level from all sources at every cell of the area, in one band. */
export function coverage(sources: readonly Source[], area: Area, band: Band, freq = 63): Grid {
  const { x0, z0, x1, z1, y, nx, nz } = area;
  const db = new Float32Array(nx * nz);
  const dx = (x1 - x0) / nx;
  const dz = (z1 - z0) / nz;
  const p = { x: 0, y, z: 0 };
  for (let iz = 0; iz < nz; iz++) {
    p.z = z0 + (iz + 0.5) * dz;
    for (let ix = 0; ix < nx; ix++) {
      p.x = x0 + (ix + 0.5) * dx;
      db[iz * nx + ix] = levelAt(sources, p, band, freq);
    }
  }
  return { ...area, db };
}
