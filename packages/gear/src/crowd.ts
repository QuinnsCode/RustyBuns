// A crowd as part of the sound: people on the floor as a density field (people per square metre), and the three things
// they do to a sound system, from room acoustics. Bodies in the line between a box and a listener soak up mids and highs
// (bass goes round them); a full room soaks up its own reverb (Sabine); and a crowd is loud on its own, so the system
// needs headroom over it. Plain numbers, no three.js. Coordinates as in sound.ts: metres, y up, the floor is x and z.

import { splAt, sumPower, type Area, type Grid, type Source, type Vec3 } from "./sound.ts";

/** Where people can stand: a rectangle of floor in cells, `density[iz * nx + ix]` people per m2 at each cell. */
export type CrowdField = { x0: number; x1: number; z0: number; z1: number; nx: number; nz: number; density: Float32Array };

/**
 * A packed front: about 4 people per m2 is where a standing crowd stops moving freely (crowd-safety guidance puts
 * "dense but safe" at 2 to 4 per m2 and crush risk past 5).
 */
export const PACKED = 4;

/** Top of a standing adult's head, metres: mean adult stature is about 1.7 m, a crowd's heads a little over. */
export const HEADS = 1.75;
/**
 * How far over the heads the line must clear before bodies stop mattering, metres: sound bends over an edge within
 * about a Fresnel zone, a few tenths of a metre at 1 to 4 kHz over 10 m, so a line just grazing heads still loses.
 */
export const CLEAR = 0.25;

/**
 * Extra loss per metre of path through a packed standing crowd (PACKED people per m2) below head height, dB/m, by
 * octave band. The shape is the grazing-incidence loss over an audience: next to nothing in the bass (a body is small
 * against a 2.7 m wave at 125 Hz), climbing through the mids as bodies get large against the wavelength, several dB
 * per 10 m from 2 kHz up (about 10 dB per 10 m at 4 kHz with the line through the heads). Measured audience loss scatters (clothing, rake, how people stand), so these are a fit to that
 * shape at standing-room density, not one paper's table. It scales with density: loss through a scatterer is per body
 * crossed (Beer-Lambert), so half the people is half the dB per metre.
 */
export const BODY_LOSS: Readonly<Record<number, number>> = { 63: 0.005, 125: 0.02, 250: 0.08, 500: 0.3, 1000: 0.6, 2000: 0.9, 4000: 1.1, 8000: 1.3 };

/**
 * Sabine absorption per standing person, m2, by octave band: a clothed adult soaks up about 0.4 to 0.5 m2 at the mid
 * frequencies, less in the bass (published standing-audience tables put 125 Hz near 0.15 to 0.2 m2).
 */
export const PERSON_SABINS: Readonly<Record<number, number>> = { 63: 0.1, 125: 0.18, 250: 0.3, 500: 0.42, 1000: 0.47, 2000: 0.5, 4000: 0.5, 8000: 0.5 };

const BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
/** A value from an octave-band table at any frequency: straight lines between bands on a log frequency scale. */
export function byBand(table: Readonly<Record<number, number>>, hz: number): number {
  if (hz <= BANDS[0]!) return table[BANDS[0]!]!;
  for (let i = 1; i < BANDS.length; i++) {
    const a = BANDS[i - 1]!, b = BANDS[i]!;
    if (hz <= b) return table[a]! + ((table[b]! - table[a]!) * Math.log2(hz / a)) / Math.log2(b / a);
  }
  return table[BANDS.at(-1)!]!;
}

/** People per m2 at a point on the floor (0 off the field). */
export function densityAt(f: CrowdField, x: number, z: number): number {
  if (x < f.x0 || x >= f.x1 || z < f.z0 || z >= f.z1) return 0;
  const ix = Math.min(f.nx - 1, Math.floor(((x - f.x0) / (f.x1 - f.x0)) * f.nx));
  const iz = Math.min(f.nz - 1, Math.floor(((z - f.z0) / (f.z1 - f.z0)) * f.nz));
  return f.density[iz * f.nx + ix]!;
}

/** How many people stand on the field. */
export function headcount(f: CrowdField): number {
  const cell = ((f.x1 - f.x0) / f.nx) * ((f.z1 - f.z0) / f.nz);
  let n = 0;
  for (const d of f.density) n += d * cell;
  return n;
}

/**
 * `people` on a floor, packed against the stage and thinning toward the back, the way a crowd stands: densest at the
 * barrier (never past `peak` per m2) and falling off with distance from the stage edge at `stageZ`. More people than
 * the floor holds at `peak` fill it at `peak`.
 */
export function fillFloor(floor: Omit<CrowdField, "density">, people: number, stageZ: number, peak = PACKED): CrowdField {
  const { x0, x1, z0, z1, nx, nz } = floor, cell = ((x1 - x0) / nx) * ((z1 - z0) / nz);
  // Metres back from the front row (the row of cells nearest the stage stands at the peak).
  const back = (iz: number) => Math.abs(z0 + ((iz + 0.5) * (z1 - z0)) / nz - stageZ), front = Math.min(back(0), back(nz - 1));
  const dist = (iz: number) => back(iz) - front;
  // Density peak * exp(-k * metres back); find the falloff k that seats exactly `people` (more k, fewer people).
  const total = (k: number) => { let n = 0; for (let iz = 0; iz < nz; iz++) n += peak * Math.exp(-k * dist(iz)) * nx * cell; return n; };
  let lo = 0, hi = 20;
  if (total(lo) <= people) hi = 0;
  else for (let i = 0; i < 40; i++) { const k = (lo + hi) / 2; if (total(k) > people) lo = k; else hi = k; }
  const density = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) density[iz * nx + ix] = people <= 0 ? 0 : peak * Math.exp(-hi * dist(iz));
  return { ...floor, density };
}

/** Sample spacing along a path, metres: about one person's depth. */
const STEP = 0.25;

/**
 * Extra dB lost between a source and a listener to the bodies in the way, at `hz`: each stretch of the line under the
 * heads (fully under HEADS, tapering to nothing CLEAR over them) loses BODY_LOSS for its length, scaled by how dense the crowd
 * is there. A box on a stick at ear height fires through every row; one raised over the heads only grazes the last few.
 */
export function crowdLoss(f: CrowdField, from: Vec3, to: Vec3, hz: number): number {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  if (d < 1e-6) return 0;
  const n = Math.max(1, Math.ceil(d / STEP)), ds = d / n, rate = byBand(BODY_LOSS, hz) / PACKED, top = HEADS + CLEAR;
  let loss = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, y = from.y + (to.y - from.y) * t;
    if (y >= top) continue;
    const rho = densityAt(f, from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t);
    if (rho > 0) loss += rho * rate * ds * Math.min(1, (top - y) / CLEAR);
  }
  return loss;
}

/** Mids and highs at a point from every source playing them, each through the crowd at `hz`, summed as power. */
export function levelThrough(sources: readonly Source[], f: CrowdField | null, p: Vec3, hz = 2000): number {
  return sumPower(sources.filter((s) => s.speaker.highCut > 500).map((s) => splAt(s, p) - (f ? crowdLoss(f, s.pos, p, hz) : 0)));
}

/** The mids-and-highs coverage map as heard through the crowd at `hz` (the same grid as sound.ts `coverage`). */
export function coverageThrough(sources: readonly Source[], f: CrowdField | null, area: Area, hz = 2000): Grid {
  const { x0, z0, x1, z1, y, nx, nz } = area, db = new Float32Array(nx * nz), p = { x: 0, y, z: 0 };
  for (let iz = 0; iz < nz; iz++) {
    p.z = z0 + ((iz + 0.5) * (z1 - z0)) / nz;
    for (let ix = 0; ix < nx; ix++) { p.x = x0 + ((ix + 0.5) * (x1 - x0)) / nx; db[iz * nx + ix] = levelThrough(sources, f, p, hz); }
  }
  return { ...area, db };
}

/** A room's box and how hard its surfaces are: `alpha` is the mean absorption coefficient (0.05 bare brick and glass, 0.3 a draped club). */
export type Room = { w: number; d: number; h: number; alpha: number };

/**
 * Reverb time RT60 in seconds with `people` in the room, at `hz` (Sabine: RT60 = 0.161 V / A, A in m2 of absorption).
 * An empty bar with hard walls rings for over a second; fill it and each body adds PERSON_SABINS, so it tightens up.
 */
export function reverbTime(room: Room, people: number, hz = 1000): number {
  const v = room.w * room.d * room.h, s = 2 * (room.w * room.d + room.w * room.h + room.d * room.h);
  return (0.161 * v) / (s * room.alpha + Math.max(0, people) * byBand(PERSON_SABINS, hz));
}

/**
 * What a crowd sounds like on its own between songs, dB SPL: about 85 dB for a few dozen talking, toward 95 dB for a
 * loud packed room (each doubling of people talking adds 3 dB, as power; a packed crowd also raises its voice). Under 4
 * people it is a quiet room, about 45 dB.
 */
export function crowdNoise(people: number): number {
  if (people < 4) return 45;
  return Math.min(95, 85 + 3 * Math.log2(people / 40));
}

/** Headroom a system wants over the crowd: music about 10 dB over the room's own noise reads as clear (speech-to-noise for clarity). */
export const HEADROOM = 10;
