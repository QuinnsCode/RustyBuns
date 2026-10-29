// The open world between the arenas, without three.js: the supercontinent's ground stitched from each
// region's real elevation, which regions you may walk into, and what happens as you walk. src/world/view.ts
// draws it; the tests walk it headless.
import { clamp, lerp } from "@rustybuns/util";
import { int, obj, rec, str } from "@rustybuns/util/guard";
import { REGIONS, type Region } from "../regions.ts";
import { GRID, PLACES } from "./places.ts";

export const GROUND_N = 33;   // samples along a region's side in ground.json
export const SEA_FLOOR = -400; // metres: deeper sea is cut to this, so a coast is a shelf, not a cliff
export const CELL = 256;      // metres of game world a region spans, whatever its real width
export const ARENA_R = 4;     // walk this close to a region's arena marker to go in
export const STEP = CELL / (GROUND_N - 1); // metres between ground samples
const SEAM = 8;               // samples either side of a region's edge that blend into the next one
const WILD_EVERY = 60;        // metres walked in a high-level region before the wild creatures come

/** ground.json: `n` × `n` Int16 metres per region, base64, row 0 the north edge. Written by scripts/fetch-world.ts. */
export const Ground = obj({ n: int(GROUND_N, GROUND_N), regions: rec(str(100_000), 64) });

/** Real metres to game metres. Square-rooted, so 6000 m of Andes is a 30 m wall and a 50 m rise is still a hill. */
export const toGame = (m: number) => (m >= 0 ? 0.4 * Math.sqrt(m) : -0.15 * Math.sqrt(-m));

export interface World {
  cols: number; rows: number; // samples
  y: Float32Array;            // game height per sample, row-major, row 0 the north edge
  width: number; depth: number;
}

/** A region's [column, row] on the world grid. Every region has a place; a missing one would be open sea at -1, -1. */
export const cell = (g: Region): [number, number] => PLACES[g.n]?.cell ?? [-1, -1];
const byCell = new Map(REGIONS.map((g) => [`${cell(g)[0]},${cell(g)[1]}`, g]));
export const regionAtCell = (cx: number, cz: number): Region | undefined => byCell.get(`${cx},${cz}`);
export const regionAt = (x: number, z: number) => regionAtCell(Math.floor(x / CELL), Math.floor(z / CELL));
export const arenaOf = (g: Region) => ({ x: (cell(g)[0] + 0.5) * CELL, z: (cell(g)[1] + 0.5) * CELL });

export function buildWorld(raw: unknown): World {
  const ground = Ground(raw);
  const n = ground.n, per = n - 1;
  const cols = GRID.w * per + 1, rows = GRID.h * per + 1;
  const regionY = new Map<number, Int16Array>();
  for (const g of REGIONS) {
    const b64 = ground.regions[g.n];
    if (!b64) continue;
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    if (bytes.length === n * n * 2) regionY.set(g.n, new Int16Array(bytes.buffer));
  }
  // Each sample is the mean of every cell that touches it, so a shared edge has one height.
  const sum = new Float32Array(cols * rows), cnt = new Uint8Array(cols * rows);
  for (let cz = 0; cz < GRID.h; cz++) for (let cx = 0; cx < GRID.w; cx++) {
    const g = regionAtCell(cx, cz), hs = g && regionY.get(g.n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = (cz * per + r) * cols + cx * per + c;
      sum[i] += toGame(hs ? hs[r * n + c]! : SEA_FLOOR); cnt[i]++;
    }
  }
  const raw_ = sum.map((s, i) => s / cnt[i]!);
  // Near a seam, ease into a blurred copy: two real places that never touched meet as a slope, not a step.
  let blur: Float32Array = raw_;
  for (let pass = 0; pass < 4; pass++) blur = boxBlur(blur, cols, rows, 2);
  const y = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = Math.min(c % per, per - (c % per), r % per, per - (r % per));
    const i = r * cols + c;
    y[i] = lerp(blur[i]!, raw_[i]!, clamp(d / SEAM, 0, 1));
  }
  const w: World = { cols, rows, y, width: GRID.w * CELL, depth: GRID.h * CELL };
  // A level pad above the water for every arena marker.
  for (const g of REGIONS) if (g.tier !== "coming-soon") {
    const a = arenaOf(g), pad = Math.max(0.6, heightAt(w, a.x, a.z));
    for (let r = Math.floor((a.z - 16) / STEP); r <= Math.ceil((a.z + 16) / STEP); r++)
      for (let c = Math.floor((a.x - 16) / STEP); c <= Math.ceil((a.x + 16) / STEP); c++) {
        const d = Math.hypot(c * STEP - a.x, r * STEP - a.z);
        if (d < 16) y[r * cols + c] = lerp(pad, y[r * cols + c]!, clamp((d - 8) / 8, 0, 1));
      }
  }
  return w;
}

function boxBlur(src: Float32Array, cols: number, rows: number, rad: number): Float32Array<ArrayBuffer> {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let s = 0, k = 0;
    for (let d = -rad; d <= rad; d++) { const cc = c + d; if (cc >= 0 && cc < cols) { s += src[r * cols + cc]!; k++; } }
    tmp[r * cols + c] = s / k;
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let s = 0, k = 0;
    for (let d = -rad; d <= rad; d++) { const rr = r + d; if (rr >= 0 && rr < rows) { s += tmp[rr * cols + c]!; k++; } }
    out[r * cols + c] = s / k;
  }
  return out;
}

/** Game height of the ground at (x, z), bilinear between samples. Below 0 is under the sea. */
export function heightAt(w: World, x: number, z: number): number {
  const fx = clamp(x / STEP, 0, w.cols - 1.001), fz = clamp(z / STEP, 0, w.rows - 1.001);
  const c = Math.floor(fx), r = Math.floor(fz), tx = fx - c, tz = fz - r, i = r * w.cols + c;
  return lerp(lerp(w.y[i]!, w.y[i + 1]!, tx), lerp(w.y[i + w.cols]!, w.y[i + w.cols + 1]!, tx), tz);
}

export const neighbours = (g: Region) =>
  REGIONS.filter((o) => Math.abs(cell(o)[0] - cell(g)[0]) + Math.abs(cell(o)[1] - cell(g)[1]) === 1);

/**
 * The regions you may walk into. The Pine Barrens is open from the start; beating a region's arena opens
 * the roads to its neighbours. The high-level south opens like the rest, and once one of it is open the
 * whole of it is, since there are no arenas there to beat. Coming-soon regions never open.
 */
export function openRegions(beaten: ReadonlySet<number>): Set<number> {
  const open = new Set<number>([1]);
  for (const n of beaten) {
    const g = REGIONS.find((x) => x.n === n);
    if (!g) continue;
    open.add(n);
    for (const o of neighbours(g)) if (o.tier !== "coming-soon") open.add(o.n);
  }
  const queue = REGIONS.filter((g) => g.tier === "high-level" && open.has(g.n));
  while (queue.length) for (const o of neighbours(queue.pop()!)) if (o.tier === "high-level" && !open.has(o.n)) { open.add(o.n); queue.push(o); }
  return open;
}

export interface Walker {
  x: number; z: number;
  region: number;  // where you are
  home: number;    // the last playable region you were in: where a lost fight sends you back to
  armed: boolean;  // false while you stand on an arena marker you just came out of
  wild: number;    // metres walked in high-level country since the last encounter
}
export type WalkEvent =
  | { kind: "enter"; region: Region }
  | { kind: "blocked"; region: Region | undefined; why: "sea" | "soon" | "locked" }
  | { kind: "arena"; region: Region }
  | { kind: "wild"; region: Region };

export function spawn(n = 1): Walker {
  const g = REGIONS.find((x) => x.n === n) ?? REGIONS[0]!, a = arenaOf(g);
  return { x: a.x, z: a.z + ARENA_R * 3, region: g.n, home: g.n, armed: true, wild: 0 };
}

/** Moves the walker by (dx, dz) metres if the ground there is open, sliding along a closed border. */
export function walk(me: Walker, dx: number, dz: number, beaten: ReadonlySet<number>): WalkEvent[] {
  const out: WalkEvent[] = [], open = openRegions(beaten);
  const can = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= GRID.w * CELL || z >= GRID.h * CELL) return false;
    const g = regionAt(x, z);
    if (g && open.has(g.n)) return true;
    if (!out.some((e) => e.kind === "blocked")) out.push({ kind: "blocked", region: g, why: !g ? "sea" : g.tier === "coming-soon" ? "soon" : "locked" });
    return false;
  };
  const x0 = me.x, z0 = me.z;
  if (can(me.x + dx, me.z)) me.x += dx;
  if (can(me.x, me.z + dz)) me.z += dz;
  const g = regionAt(me.x, me.z)!;
  if (g.n !== me.region) {
    me.region = g.n; me.wild = 0;
    if (g.tier === "playable") me.home = g.n;
    out.push({ kind: "enter", region: g });
  }
  if (g.tier === "playable") {
    const a = arenaOf(g), d = Math.hypot(me.x - a.x, me.z - a.z);
    if (d < ARENA_R && me.armed) { me.armed = false; out.push({ kind: "arena", region: g }); }
    else if (d > ARENA_R * 2) me.armed = true;
  } else if (g.tier === "high-level") {
    me.wild += Math.hypot(me.x - x0, me.z - z0);
    if (me.wild >= WILD_EVERY) { me.wild = 0; out.push({ kind: "wild", region: g }); }
  }
  return out;
}

/** After a fight lost in the wild or an arena: back on your last playable arena's doorstep. */
export function sendHome(me: Walker) {
  Object.assign(me, spawn(me.home));
}
