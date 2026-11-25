// The room's PA over its floor, from above: @rustybuns/gear's coverage map of the very boxes the jam room plays the set
// from (pa-room.ts paSources), so the map in the builder is what you hear on Walk in. The colours are against a level
// you name (the floor's middle, pa-room.ts floorMiddle, where the PA sets its level): pale gold louder than it, orange within 3 dB,
// teal 9 dB down, deep blue past 15. The rig cards (rig-cards.ts) paint the same ramp. Pure but for `heatUrl`.
import { coverage, floorStats, levelAt, type Area, type FloorStats, type Grid } from "@rustybuns/gear";
import { arrivalSpread, EAR_Y, floorMiddle, paSources, paSpeakers } from "./pa-room.ts";
import type { StudioDef } from "./room.ts";

/** The colour ramp, dB under the reference against RGB. */
const RAMP: [number, [number, number, number]][] = [[-6, [255, 236, 170]], [0, [255, 140, 80]], [3, [230, 90, 70]], [9, [40, 150, 160]], [15, [18, 30, 70]]];

/** The colour a cell `down` dB under the reference is drawn. */
export function heatRgb(down: number): [number, number, number] {
  const d = Math.max(-6, Math.min(15, down));
  let i = 0;
  while (i < RAMP.length - 2 && d > RAMP[i + 1]![0]) i++;
  const [d0, c0] = RAMP[i]!, [d1, c1] = RAMP[i + 1]!, t = Math.max(0, Math.min(1, (d - d0) / (d1 - d0)));
  return [0, 1, 2].map((ch) => Math.round(c0[ch]! + (c1[ch]! - c0[ch]!) * t)) as [number, number, number];
}

/** A grid as RGBA pixels, row by row as the grid is (+z down the picture), against `ref` dB. */
export function heatPixels(grid: Grid, ref: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(grid.nx * grid.nz * 4);
  for (let k = 0; k < grid.db.length; k++) { px.set(heatRgb(ref - grid.db[k]!), k * 4); px[k * 4 + 3] = 255; }
  return px;
}

/** The grid as a picture, a cell a pixel (needs a DOM). */
export function heatCanvas(grid: Grid, ref: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = grid.nx; c.height = grid.nz;
  const g = c.getContext("2d")!, img = g.createImageData(grid.nx, grid.nz);
  img.data.set(heatPixels(grid, ref));
  g.putImageData(img, 0, 0);
  return c;
}

/** What the builder shows of the PA: the map over the whole ground, `cell` metres a cell, its reference level (the
 *  floor's middle), and how the crowd's part of it sounds (the ground in front of the speakers' line). */
export type FloorMap = { grid: Grid; ref: number; stats: FloorStats; middle: [number, number] };

export function floorMap(def: StudioDef, cell = 0.5): FloorMap | null {
  const sp = paSpeakers(def);
  if (!sp.length) return null;
  const mid = floorMiddle(sp), middle: [number, number] = [mid.x, mid.z];
  const { w, d } = def.size, area: Area = { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2, y: EAR_Y, nx: Math.max(1, Math.round(w / cell)), nz: Math.max(1, Math.round(d / cell)) };
  const src = paSources(def), grid = coverage(src, area, "high"), ref = levelAt(src, { x: middle[0], y: EAR_Y, z: middle[1] }, "high");
  // the crowd's floor: a metre or more in front of the line the speakers stand on, as they face
  const mx = sp.reduce((t, s) => t + s.at[0], 0) / sp.length, mz = sp.reduce((t, s) => t + s.at[1], 0) / sp.length;
  const fx = middle[0] - mx, fz = middle[1] - mz, len = Math.hypot(fx, fz) || 1;
  const stats = floorStats(grid, (x, z) => ((x - mx) * fx + (z - mz) * fz) / len > 1);
  return { grid, ref, stats, middle };
}

/** The level at a point on the floor, dB, read off a map (the nearest cell). */
export function mapAt(m: FloorMap, x: number, z: number): number {
  const { x0, x1, z0, z1, nx, nz, db } = m.grid;
  const ix = Math.max(0, Math.min(nx - 1, Math.floor(((x - x0) / (x1 - x0)) * nx))), iz = Math.max(0, Math.min(nz - 1, Math.floor(((z - z0) / (z1 - z0)) * nz)));
  return db[iz * nx + ix]!;
}

/** The delay view: across the ground, `cell` metres a cell, how far apart the PA's speakers land (pa-room.ts
 *  arrivalSpread, ms), in a grid laid out as the coverage map's. */
export type DelayMap = Area & { ms: Float32Array };
export function delayMap(def: StudioDef, cell = 1): DelayMap | null {
  if (paSpeakers(def).length < 2) return null;
  const { w, d } = def.size, nx = Math.max(1, Math.round(w / cell)), nz = Math.max(1, Math.round(d / cell));
  const ms = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) ms[iz * nx + ix] = arrivalSpread(def, -w / 2 + (ix + 0.5) * w / nx, -d / 2 + (iz + 0.5) * d / nz);
  return { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2, y: EAR_Y, nx, nz, ms };
}

/** How a spread of `ms` is drawn: clear under 10 ms (one sound), amber to 30 (a smear), red past it (an echo: a delay tower's place). */
export function delayRgba(ms: number): [number, number, number, number] {
  if (ms < 10) return [0, 0, 0, 0];
  if (ms < 30) return [255, 190, 60, 90 + Math.round((ms - 10) * 4)];
  return [230, 60, 60, 200];
}

/** The delay map as a picture, a cell a pixel (needs a DOM). */
export function delayCanvas(m: DelayMap): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = m.nx; c.height = m.nz;
  const g = c.getContext("2d")!, img = g.createImageData(m.nx, m.nz);
  m.ms.forEach((v, k) => img.data.set(delayRgba(v), k * 4));
  g.putImageData(img, 0, 0);
  return c;
}
