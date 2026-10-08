// The park as a grid of cells. Every rule in the game is answered on this grid:
// hiders hide at cell centres, and "nearest lake" or "distance to water" are
// per-cell lookups. The server's answer for a hider and the shading drawn for
// the seeker come from the same numbers, so they can never disagree.

import { bounds, dist, inRing, ringArea, type Pt } from "./geo.ts";
import type { Landmark, ParkData } from "./parks/types.ts";

/** Roughly how many cells the park itself covers, whatever its shape. */
export const GRID_CELLS_IN_PARK = 12000;

export type MatchCat = "peak" | "lake" | "sight";
export type MeasureWhat = "water" | "road";

export interface Feature { name: string; x: number; y: number }

export interface Grid {
  park: ParkData;
  /** The park's longer side in km. Walking speed scales with it, so crossing takes the same time anywhere. */
  D: number;
  /**
   * The park's size by area (km, about D for a squarish park). Reach, radar and the
   * no-hide circle scale with this, so a long thin park like the Grand Canyon or
   * Acadia's islands doesn't get a reach as wide as the park.
   */
  S: number;
  cols: number;
  rows: number;
  cell: number;
  x0: number;
  y0: number;
  inPark: Uint8Array;
  /** Cells inside the park, for picking random spots. */
  parkCells: Int32Array;
  /** km to the nearest lake or river (0 on the water). */
  distTo: Record<MeasureWhat, Float32Array | null>;
  /** Index into `features[cat]` of the nearest one, per cell. */
  nearest: Record<MatchCat, Int16Array | null>;
  features: Record<MatchCat, Feature[]>;
}

const cache = new Map<string, Grid>();

export function gridFor(park: ParkData): Grid {
  let g = cache.get(park.code);
  if (!g) { g = buildGrid(park); cache.set(park.code, g); }
  return g;
}

export function buildGrid(park: ParkData): Grid {
  const b = bounds(park.outline);
  const D = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const area = park.outline.reduce((a, r) => a + ringArea(r), 0);
  const S = Math.min(D, Math.sqrt(area) * 1.35);
  // Fine enough for ~GRID_CELLS_IN_PARK cells inside, capped for very sparse shapes.
  const cell = Math.max(Math.sqrt(area / GRID_CELLS_IN_PARK), D / 400);
  const cols = Math.ceil((b.maxX - b.minX) / cell) + 2;
  const rows = Math.ceil((b.maxY - b.minY) / cell) + 2;
  const x0 = b.minX - cell, y0 = b.minY - cell;
  const n = cols * rows;
  const g: Grid = {
    park, D, S, cols, rows, cell, x0, y0,
    inPark: new Uint8Array(n), parkCells: new Int32Array(0),
    distTo: { water: null, road: null }, nearest: { peak: null, lake: null, sight: null },
    features: { peak: [], lake: [], sight: [] },
  };
  // One ring at a time: NPS boundaries can overlap (tracts), and the park is their union.
  for (const ring of park.outline) scanFill(g, [ring], (i) => { g.inPark[i] = 1; });
  const inside: number[] = [];
  for (let i = 0; i < n; i++) if (g.inPark[i]) inside.push(i);
  g.parkCells = Int32Array.from(inside);

  // Water: lake cells plus river lines, then a distance transform outwards.
  const water = new Int32Array(n).fill(-1);
  const lakes = park.lakes.filter((l) => l.ring.length >= 3);
  lakes.forEach((l, li) => rasterRing(g, l.ring, (i) => { water[i] = li; }));
  // A lake too small for any cell centre still gets the cell it sits in.
  lakes.forEach((l, li) => { const c = centroidOf(l.ring); const i = cellAt(g, c[0], c[1]); if (water[i] < 0) water[i] = li; });
  const riverSeed = new Int32Array(n).fill(-1);
  for (const r of park.rivers) rasterLine(g, r.line, (i) => { riverSeed[i] = 0; });
  if (lakes.length || park.rivers.length) {
    const seeds = new Int32Array(n);
    for (let i = 0; i < n; i++) seeds[i] = water[i] >= 0 || riverSeed[i] >= 0 ? 0 : -1;
    g.distTo.water = transform(g, seeds).dist;
  }
  if (park.roads.length) {
    const seeds = new Int32Array(n).fill(-1);
    for (const r of park.roads) rasterLine(g, r.line, (i) => { seeds[i] = 0; });
    g.distTo.road = transform(g, seeds).dist;
  }

  // Matching: only features inside the park count, and a category needs two.
  const inParkMark = (m: Landmark) => g.inPark[cellAt(g, m.x, m.y)] === 1;
  const peaks = park.landmarks.filter((m) => m.kind === "peak" && inParkMark(m));
  const sights = park.landmarks.filter((m) => m.kind !== "peak" && m.kind !== "start" && inParkMark(m));
  if (peaks.length >= 2) { g.features.peak = peaks.map(feat); g.nearest.peak = voronoi(g, g.features.peak); }
  if (sights.length >= 2) { g.features.sight = sights.map(feat); g.nearest.sight = voronoi(g, g.features.sight); }
  if (lakes.length >= 2) {
    g.features.lake = lakes.map((l) => { const c = centroidOf(l.ring); return { name: l.name, x: c[0], y: c[1] }; });
    g.nearest.lake = transform(g, water).label;
  }
  return g;
}

const feat = (m: Landmark): Feature => ({ name: m.name, x: m.x, y: m.y });

export const cellX = (g: Grid, i: number) => g.x0 + ((i % g.cols) + 0.5) * g.cell;
export const cellY = (g: Grid, i: number) => g.y0 + (Math.floor(i / g.cols) + 0.5) * g.cell;

/** The cell under (x, y), clamped to the grid. */
export function cellAt(g: Grid, x: number, y: number): number {
  const c = Math.max(0, Math.min(g.cols - 1, Math.floor((x - g.x0) / g.cell)));
  const r = Math.max(0, Math.min(g.rows - 1, Math.floor((y - g.y0) / g.cell)));
  return r * g.cols + c;
}

export function clampToGrid(g: Grid, x: number, y: number): Pt {
  const e = g.cell * 0.5;
  return [Math.max(g.x0 + e, Math.min(g.x0 + g.cols * g.cell - e, x)), Math.max(g.y0 + e, Math.min(g.y0 + g.rows * g.cell - e, y))];
}

function centroidOf(ring: Pt[]): Pt {
  // Area-weighted, so a crescent lake's label lands near its bulk.
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9 || ringArea(ring) < 1e-9) return [ring[0][0], ring[0][1]];
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * Even-odd fill of cell centres, a row at a time: find where each row crosses
 * the edges, then fill between pairs. Same answer as inRings per cell, at a
 * fraction of the cost on detailed coastlines (Acadia) and long parks (Grand Canyon).
 */
function scanFill(g: Grid, rings: Pt[][], hit: (i: number) => void) {
  const xs: number[] = [];
  for (let r = 0; r < g.rows; r++) {
    const y = g.y0 + (r + 0.5) * g.cell;
    xs.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.cell - 0.5));
      const c1 = Math.min(g.cols - 1, Math.floor((xs[k + 1] - g.x0) / g.cell - 0.5));
      for (let c = c0; c <= c1; c++) hit(r * g.cols + c);
    }
  }
}

function rasterRing(g: Grid, ring: Pt[], hit: (i: number) => void) {
  const b = bounds([ring]);
  const c0 = Math.max(0, Math.floor((b.minX - g.x0) / g.cell)), c1 = Math.min(g.cols - 1, Math.floor((b.maxX - g.x0) / g.cell));
  const r0 = Math.max(0, Math.floor((b.minY - g.y0) / g.cell)), r1 = Math.min(g.rows - 1, Math.floor((b.maxY - g.y0) / g.cell));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const i = r * g.cols + c;
    if (inRing(cellX(g, i), cellY(g, i), ring)) hit(i);
  }
}

function rasterLine(g: Grid, line: Pt[], hit: (i: number) => void) {
  for (let k = 1; k < line.length; k++) {
    const [ax, ay] = line[k - 1], [bx, by] = line[k];
    const steps = Math.max(1, Math.ceil(dist(ax, ay, bx, by) / (g.cell * 0.5)));
    for (let s = 0; s <= steps; s++) hit(cellAt(g, ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps));
  }
  if (line.length === 1) hit(cellAt(g, line[0][0], line[0][1]));
}

/**
 * Two-pass chamfer distance transform from labelled seed cells (label >= 0).
 * Returns km to the nearest seed and that seed's label. Within a few percent of
 * Euclidean, which is plenty: the rules only ever compare grid values to grid values.
 */
export function transform(g: Grid, seeds: Int32Array): { dist: Float32Array; label: Int16Array } {
  const { cols, rows } = g;
  const n = cols * rows;
  const d = new Float32Array(n).fill(Infinity);
  const label = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (seeds[i] >= 0) { d[i] = 0; label[i] = seeds[i]; }
  const a = 1, b = Math.SQRT2;
  const relax = (i: number, j: number, w: number) => { if (d[j] + w < d[i]) { d[i] = d[j] + w; label[i] = label[j]; } };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (c > 0) relax(i, i - 1, a);
    if (r > 0) {
      relax(i, i - cols, a);
      if (c > 0) relax(i, i - cols - 1, b);
      if (c < cols - 1) relax(i, i - cols + 1, b);
    }
  }
  for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
    const i = r * cols + c;
    if (c < cols - 1) relax(i, i + 1, a);
    if (r < rows - 1) {
      relax(i, i + cols, a);
      if (c < cols - 1) relax(i, i + cols + 1, b);
      if (c > 0) relax(i, i + cols - 1, b);
    }
  }
  for (let i = 0; i < n; i++) d[i] *= g.cell;
  return { dist: d, label };
}

/** Nearest feature per cell, exactly (features are few). */
function voronoi(g: Grid, fs: Feature[]): Int16Array {
  const out = new Int16Array(g.cols * g.rows);
  for (let i = 0; i < out.length; i++) {
    const x = cellX(g, i), y = cellY(g, i);
    let best = Infinity, at = 0;
    for (let k = 0; k < fs.length; k++) {
      const dd = (fs[k].x - x) ** 2 + (fs[k].y - y) ** 2;
      if (dd < best) { best = dd; at = k; }
    }
    out[i] = at;
  }
  return out;
}
