// The open world between the arenas, without three.js: the supercontinent's ground stitched from each
// region's real elevation, which regions you may walk into, and what happens as you walk. src/world/view.ts
// draws it; the tests walk it headless.
import { clamp, lerp } from "@rustybuns/util";
import { int, obj, rec, str } from "@rustybuns/util/guard";
import { ROWS as CREATURES } from "../creatures.ts";
import { REGIONS, type Biome, type Region } from "../regions.ts";
import { inSeason, ROAM_WEIGHT, tierOf, TIER_LEVEL } from "../tiers.ts";
import { GRID, PLACES } from "./places.ts";

export const GROUND_N = 33;   // samples along a region's side in ground.json
export const SEA_FLOOR = -400; // metres: deeper sea is cut to this, so a coast is a shelf, not a cliff
export const SCALE = 5;       // how many times wider the world is than its first cut, which had 256 m regions
export const CELL = 256 * SCALE; // metres of game world a region spans, whatever its real width
export const ARENA_R = 4;     // walk this close to a region's arena marker to go in
export const STEP = CELL / (GROUND_N - 1); // metres between ground samples
const SEAM = 6;               // samples either side of a border that blend into the next region
const WILD_EVERY = 120;       // metres walked in a high-level region before the wild creatures come
const PAD_R = 16;             // metres of level ground around every arena marker

/** ground.json: `n` × `n` Int16 metres per region, base64, row 0 the north edge. Written by scripts/fetch-world.ts. */
export const Ground = obj({ n: int(GROUND_N, GROUND_N), regions: rec(str(100_000), 64) });

/** Real metres to game metres. Square-rooted, so 6000 m of Andes is a 30 m wall and a 50 m rise is still a hill. */
export const toGame = (m: number) => (m >= 0 ? 0.4 * Math.sqrt(m) : -0.15 * Math.sqrt(-m));

export interface World {
  cols: number; rows: number; // samples
  y: Float32Array;            // game height per sample, row-major, row 0 the north edge
  /** How rough the ground is near each sample, metres: the fine detail heightAt adds between samples. */
  rough: Float32Array;
  /** The level pad under each open arena, by region number. */
  pads: Map<number, { x: number; z: number; y: number }>;
  width: number; depth: number;
}

/** A region's [column, row] on the world grid. Every region has a place; a missing one would be open sea at -1, -1. */
export const cell = (g: Region): [number, number] => PLACES[g.n]?.cell ?? [-1, -1];
const byCell = new Map(REGIONS.map((g) => [`${cell(g)[0]},${cell(g)[1]}`, g]));
const byN = new Map(REGIONS.map((g) => [g.n, g]));
export const regionAtCell = (cx: number, cz: number): Region | undefined => byCell.get(`${cx},${cz}`);

// --- the pieces: where one region ends and the next begins ---------------------------------------------------
// The grid only says which region sits next to which. Each region is grown from a seed jittered off its
// cell's centre, through a slow warp of the plane, so a region is a piece with a ragged edge, not a square,
// and the empty cells and a ring around the grid are sea seeds, which gives the supercontinent a coast.

/** Samples across and down the whole world, as in ground.json's grid. */
export const COLS = GRID.w * (GROUND_N - 1) + 1, ROWS = GRID.h * (GROUND_N - 1) + 1;

function hash(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in [-1, 1]. */
function noise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  return 2 * lerp(lerp(hash(xi, yi, s), hash(xi + 1, yi, s), sx), lerp(hash(xi, yi + 1, s), hash(xi + 1, yi + 1, s), sx), sy) - 1;
}
const WARP = 0.4; // cells
/** Where (u, v), in cells, lands in the warped plane the pieces are cut in. */
function warp(u: number, v: number): [number, number] {
  const o = (s: number) => noise(u * 1.2, v * 1.2, s) * 0.7 + noise(u * 3.1, v * 3.1, s + 1) * 0.22 + noise(u * 7, v * 7, s + 2) * 0.12;
  return [u + WARP * o(1), v + WARP * o(11)];
}

interface Seed { n: number; u: number; v: number; wu: number; wv: number } // n 0 is sea; u, v in cells
const SEEDS = new Map<string, Seed>();
for (let cz = -1; cz <= GRID.h; cz++) for (let cx = -1; cx <= GRID.w; cx++) {
  const g = regionAtCell(cx, cz), j = g ? 0.26 : 0.4;
  const u = cx + 0.5 + j * (2 * hash(cx, cz, 5) - 1), v = cz + 0.5 + j * (2 * hash(cx, cz, 6) - 1);
  const [wu, wv] = warp(u, v);
  SEEDS.set(`${cx},${cz}`, { n: g?.n ?? 0, u, v, wu, wv });
}

/** The region number that owns each sample, row-major, row 0 the north edge; 0 is sea. */
export const OWNER: Uint8Array = (() => {
  const own = new Uint8Array(COLS * ROWS), per = GROUND_N - 1;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const u = c / per, v = r / per, [wu, wv] = warp(u, v);
    // Sea wins near the world's edge, so the land never runs off it.
    const edge = Math.min(u, v, GRID.w - u, GRID.h - v), seaPull = lerp(0.3, 1, clamp(edge / 0.7, 0, 1));
    if (edge < 0.1) continue;
    let best = Infinity, n = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const s = SEEDS.get(`${Math.floor(wu) + dx},${Math.floor(wv) + dz}`);
      if (!s) continue;
      const d = Math.hypot(wu - s.wu, wv - s.wv) * (s.n ? 1 : seaPull);
      if (d < best) { best = d; n = s.n; }
    }
    own[r * COLS + c] = n;
  }
  // Every arena stands in its own region, whatever the warp did.
  for (const g of REGIONS) {
    const s = SEEDS.get(cell(g).join())!, R = Math.max(2, (PAD_R * 2) / STEP);
    for (let r = Math.floor(s.v * per - R); r <= Math.ceil(s.v * per + R); r++)
      for (let c = Math.floor(s.u * per - R); c <= Math.ceil(s.u * per + R); c++)
        if (r >= 0 && c >= 0 && r < ROWS && c < COLS && Math.hypot(c - s.u * per, r - s.v * per) <= R) own[r * COLS + c] = g.n;
  }
  return own;
})();

export const ownerAt = (x: number, z: number) => {
  const c = Math.round(x / STEP), r = Math.round(z / STEP);
  return c < 0 || r < 0 || c >= COLS || r >= ROWS ? 0 : OWNER[r * COLS + c]!;
};
export const regionAt = (x: number, z: number) => byN.get(ownerAt(x, z));
/** A region's arena: at its seed, somewhere near its cell's middle. */
export const arenaOf = (g: Region) => { const s = SEEDS.get(cell(g).join())!; return { x: s.u * CELL, z: s.v * CELL }; };

// Two regions are neighbours when their pieces share a stretch of border, not just a corner.
const NEIGH = new Map<number, Set<number>>(REGIONS.map((g) => [g.n, new Set()]));
{
  const shared = new Map<string, number>();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const a = OWNER[r * COLS + c]!;
    for (const b of [c + 1 < COLS ? OWNER[r * COLS + c + 1]! : 0, r + 1 < ROWS ? OWNER[(r + 1) * COLS + c]! : 0])
      if (a && b && a !== b) { const k = a < b ? `${a},${b}` : `${b},${a}`; shared.set(k, (shared.get(k) ?? 0) + 1); }
  }
  for (const [k, len] of shared) if (len >= 4) { const [a, b] = k.split(",").map(Number) as [number, number]; NEIGH.get(a)!.add(b); NEIGH.get(b)!.add(a); }
}
export const neighbours = (g: Region): Region[] => [...(NEIGH.get(g.n) ?? [])].map((n) => byN.get(n)!);

/** A region's real ground at world (x, z): its fetched square, mirrored past the edge where its piece pokes out. */
function realAt(hs: Int16Array, n: number, g: Region, x: number, z: number) {
  const m = (t: number) => clamp(t < 0 ? -t : t > 1 ? 2 - t : t, 0, 1);
  const fx = m(x / CELL - cell(g)[0]) * (n - 1), fz = m(z / CELL - cell(g)[1]) * (n - 1);
  const c = Math.min(Math.floor(fx), n - 2), r = Math.min(Math.floor(fz), n - 2), tx = fx - c, tz = fz - r, i = r * n + c;
  return lerp(lerp(hs[i]!, hs[i + 1]!, tx), lerp(hs[i + n]!, hs[i + n + 1]!, tx), tz);
}

export function buildWorld(raw: unknown): World {
  const ground = Ground(raw);
  const n = ground.n, cols = COLS, rows = ROWS;
  const regionY = new Map<number, Int16Array>();
  for (const g of REGIONS) {
    const b64 = ground.regions[g.n];
    if (!b64) continue;
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    if (bytes.length === n * n * 2) regionY.set(g.n, new Int16Array(bytes.buffer));
  }
  const raw_ = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, g = byN.get(OWNER[i]!), hs = g && regionY.get(g.n);
    raw_[i] = toGame(g && hs ? Math.max(SEA_FLOOR, realAt(hs, n, g, c * STEP, r * STEP)) : SEA_FLOOR);
  }
  // Near a border, ease into a blurred copy: two real places that never touched meet as a slope, not a step.
  let blur: Float32Array = raw_;
  for (let pass = 0; pass < 4; pass++) blur = boxBlur(blur, cols, rows, 2);
  const d = borderDistance(OWNER, cols, rows);
  const y = new Float32Array(cols * rows);
  for (let i = 0; i < y.length; i++) y[i] = lerp(blur[i]!, raw_[i]!, clamp(d[i]! / SEAM, 0, 1));
  // How rough each biome's ground is between samples, blurred so it never steps at a border.
  let rough = new Float32Array(cols * rows);
  for (let i = 0; i < rough.length; i++) { const g = byN.get(OWNER[i]!); rough[i] = g ? ROUGH[g.biome] : 0; }
  for (let pass = 0; pass < 3; pass++) rough = boxBlur(rough, cols, rows, 2);
  const w: World = { cols, rows, y, rough, pads: new Map(), width: GRID.w * CELL, depth: GRID.h * CELL };
  // A level pad above the water for every arena marker, at the ground's height there.
  for (const g of REGIONS) if (g.tier !== "coming-soon") {
    const a = arenaOf(g);
    w.pads.set(g.n, { ...a, y: Math.max(0.6, baseAt(w, a.x, a.z) + detailAt(w, a.x, a.z, baseAt(w, a.x, a.z))) });
  }
  return w;
}

// --- the fine ground: what lies between two samples 40 m apart ---------------------------------------------------
// The real elevation gives the hills; a seeded fractal adds the hummocks, gullies and boulder fields a region
// of that biome has, so the ground under your feet is never a flat 40 m facet. Rough in the mountains, gentle
// on the plains and the swamp, none under the sea, and fading out on the beach.
const ROUGH: Record<Biome, number> = {
  "pine-barrens": 1.2, forest: 2.4, rainforest: 2.6, lake: 1.2, desert: 2, swamp: 0.4, plains: 0.8, highlands: 3.6, jungle: 2.2,
  island: 1.4, mountains: 6, river: 1, coast: 1.8, savanna: 1, tundra: 1.4, steppe: 0.8,
};
const OCTAVES: [number, number][] = [[190, 1], [72, 0.5], [27, 0.24], [10, 0.1]]; // wavelength m, weight
/** The fine detail at (x, z), metres, for ground whose coarse height there is `base`. */
export function detailAt(w: World, x: number, z: number, base: number): number {
  if (base <= 0) return 0;
  let d = 0;
  for (let k = 0; k < OCTAVES.length; k++) { const [l, a] = OCTAVES[k]!; d += a * noise(x / l, z / l, 31 + k); }
  return d * sample(w.rough, w, x, z) * clamp(base / 1.5, 0, 1);
}
/** Bilinear between samples of a per-sample field. */
function sample(f: Float32Array, w: World, x: number, z: number) {
  const fx = clamp(x / STEP, 0, w.cols - 1.001), fz = clamp(z / STEP, 0, w.rows - 1.001);
  const c = Math.floor(fx), r = Math.floor(fz), tx = fx - c, tz = fz - r, i = r * w.cols + c;
  return lerp(lerp(f[i]!, f[i + 1]!, tx), lerp(f[i + w.cols]!, f[i + w.cols + 1]!, tx), tz);
}
const baseAt = (w: World, x: number, z: number) => sample(w.y, w, x, z);
/**
 * The ground at (x, z) from a coarse height `base` (the real one, or a lower one while a piece is unformed):
 * `detail` of the fine detail added and `pad` of the way flattened onto an arena's pad. heightAt is all of both.
 */
export function surface(w: World, x: number, z: number, base: number, detail = 1, pad = 1): number {
  let h = base + detail * detailAt(w, x, z, base);
  const p = pad > 0 ? w.pads.get(ownerAt(x, z)) : undefined;
  if (p) { const d = Math.hypot(x - p.x, z - p.z); if (d < PAD_R) h = lerp(h, lerp(p.y, h, clamp((d - PAD_R / 2) / (PAD_R / 2), 0, 1)), pad); }
  return h;
}

/** Samples from each sample to the nearest one owned by someone else (a two-pass chamfer). */
function borderDistance(own: Uint8Array, cols: number, rows: number): Float32Array {
  const d = new Float32Array(cols * rows).fill(1e9), D = Math.SQRT2;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, o = own[i];
    if ((c > 0 && own[i - 1] !== o) || (c < cols - 1 && own[i + 1] !== o) || (r > 0 && own[i - cols] !== o) || (r < rows - 1 && own[i + cols] !== o)) d[i] = 0;
  }
  const relax = (i: number, j: number, k: number) => { if (d[j]! + k < d[i]!) d[i] = d[j]! + k; };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (c > 0) relax(i, i - 1, 1);
    if (r > 0) { relax(i, i - cols, 1); if (c > 0) relax(i, i - cols - 1, D); if (c < cols - 1) relax(i, i - cols + 1, D); }
  }
  for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
    const i = r * cols + c;
    if (c < cols - 1) relax(i, i + 1, 1);
    if (r < rows - 1) { relax(i, i + cols, 1); if (c < cols - 1) relax(i, i + cols + 1, D); if (c > 0) relax(i, i + cols - 1, D); }
  }
  return d;
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

/** Game height of the ground at (x, z): the samples, the fine detail between them, the arena pads. Below 0 is under the sea. */
export const heightAt = (w: World, x: number, z: number): number => surface(w, x, z, baseAt(w, x, z));

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

/**
 * The arena that opens the road to closed region g: an open, unbeaten playable neighbour, the one you're
 * in (`from`) first when it qualifies. Undefined when g is already open, or no such arena borders it.
 */
export function opensRoadTo(g: Region, beaten: ReadonlySet<number>, from = 0): Region | undefined {
  const open = openRegions(beaten);
  if (open.has(g.n)) return undefined;
  const near = neighbours(g).filter((o) => o.tier === "playable" && open.has(o.n) && !beaten.has(o.n));
  return near.find((o) => o.n === from) ?? near[0];
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
  | { kind: "blocked"; region: Region | undefined; why: "sea" | "soon" | "locked" | "gate" }
  | { kind: "arena"; region: Region }
  | { kind: "wild"; region: Region };

export function spawn(n = 1): Walker {
  const g = REGIONS.find((x) => x.n === n) ?? REGIONS[0]!, a = arenaOf(g);
  return { x: a.x, z: a.z + ARENA_R * 3, region: g.n, home: g.n, armed: true, wild: 0 };
}

/** Moves the walker by (dx, dz) metres if the ground there is open, sliding along a closed border. `fence`, when
 * given, closes more ground inside open regions (a trail's sections not reached yet, src/world/trail.ts): true blocks. */
export function walk(me: Walker, dx: number, dz: number, beaten: ReadonlySet<number>, fence?: (x: number, z: number) => boolean): WalkEvent[] {
  const out: WalkEvent[] = [], open = openRegions(beaten);
  const can = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= GRID.w * CELL || z >= GRID.h * CELL) return false;
    const g = regionAt(x, z);
    if (g && open.has(g.n) && fence?.(x, z)) {
      if (!out.some((e) => e.kind === "blocked")) out.push({ kind: "blocked", region: g, why: "gate" });
      return false;
    }
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

// --- what you've seen: the map fills in as you walk ---------------------------------------------------------
export const FOG = 64; // metres a cell of the fog covers
export const FOG_W = Math.ceil((GRID.w * CELL) / FOG), FOG_H = Math.ceil((GRID.h * CELL) / FOG);
const SIGHT = 140;     // metres you see around you
/** The region at the middle of each fog cell. */
const FOG_OWNER = Uint8Array.from({ length: FOG_W * FOG_H }, (_, i) => ownerAt(((i % FOG_W) + 0.5) * FOG, (Math.floor(i / FOG_W) + 0.5) * FOG));
const FOG_SIZE = new Map<number, number>();
for (const n of FOG_OWNER) if (n) FOG_SIZE.set(n, (FOG_SIZE.get(n) ?? 0) + 1);

/** One bit per fog cell, set once seen. */
export const newSeen = () => new Uint8Array(Math.ceil((FOG_W * FOG_H) / 8));
export const isSeen = (seen: Uint8Array, i: number) => (seen[i >> 3]! & (1 << (i & 7))) !== 0;

/** Clears the fog around (x, z). How many cells it cleared. */
export function explore(seen: Uint8Array, x: number, z: number): number {
  let fresh = 0;
  const r = Math.ceil(SIGHT / FOG), cx = Math.floor(x / FOG), cz = Math.floor(z / FOG);
  for (let j = cz - r; j <= cz + r; j++) for (let k = cx - r; k <= cx + r; k++) {
    if (k < 0 || j < 0 || k >= FOG_W || j >= FOG_H || Math.hypot((k + 0.5) * FOG - x, (j + 0.5) * FOG - z) > SIGHT) continue;
    const i = j * FOG_W + k;
    if (!isSeen(seen, i)) { seen[i >> 3]! |= 1 << (i & 7); fresh++; }
  }
  return fresh;
}

/** How much of region n you've seen, 0 to 1. */
export function explored(seen: Uint8Array, n: number): number {
  let k = 0;
  for (let i = 0; i < FOG_OWNER.length; i++) if (FOG_OWNER[i] === n && isSeen(seen, i)) k++;
  return k / (FOG_SIZE.get(n) ?? 1);
}

// --- wild creatures roaming the open regions -------------------------------------------------------------------
// The country between the arenas is split into dens DEN metres across. Some dens hold one wild creature from
// the region's own legends (now and then one wandered over from the regions either side on the route),
// circling its den. Walk into one and it fights you; win and it joins your party. Where a den is and who
// lives there come from a hash of the den, and where it has wandered to from the time, so the same den
// always holds the same creature and a test can say where it will be.
export const DEN = 150;          // metres across a den
export const MEET_R = 3.5;       // walk this close to a wild creature to fight it
const DEN_CHANCE = 0.4;          // of the dens on open, dry, playable ground, how many hold a creature

export interface Wild { den: string; id: string; region: number; level: number; x: number; z: number; heading: number }

/** Who may roam region n on a day: its own creatures three times over and the ones from the regions either side
 * once, each as often as its tier turns up (src/tiers.ts); mythics stay home, event creatures keep their season. */
const pools = new Map<string, Map<number, string[]>>();
function poolOf(n: number, date: Date): string[] {
  const day = `${date.getMonth()}-${date.getDate()}`;
  let byRegion = pools.get(day);
  if (!byRegion) {
    byRegion = new Map(REGIONS.map((g) => [g.n, CREATURES.flatMap((c) => {
      const home = c.region === g.n, t = tierOf(c.id);
      if (!inSeason(c.id, date) || !(home || (Math.abs(c.region - g.n) === 1 && t !== "mythic"))) return [];
      return Array<string>(ROAM_WEIGHT[t] * (home ? 3 : 1)).fill(c.id);
    })]));
    pools.clear(); pools.set(day, byRegion);
  }
  return byRegion.get(n) ?? [];
}

/** How strong the wild ones of region n are: 1 in the Pine Barrens, climbing along the route, a few levels of spread. */
export const wildLevel = (n: number, roll: number) => 1 + 2 * (n - 1) + Math.floor(roll * 3);

/** The wild creatures within `radius` of (x, z) at time `t` seconds, on ground you may walk. */
export function wildsNear(w: World, x: number, z: number, t: number, open: ReadonlySet<number>, radius = 200, date = new Date()): Wild[] {
  const out: Wild[] = [];
  for (let cz = Math.floor((z - radius) / DEN); cz <= Math.floor((z + radius) / DEN); cz++)
    for (let cx = Math.floor((x - radius) / DEN); cx <= Math.floor((x + radius) / DEN); cx++) {
      if (hash(cx, cz, 41) > DEN_CHANCE) continue;
      const hx = (cx + 0.25 + 0.5 * hash(cx, cz, 42)) * DEN, hz = (cz + 0.25 + 0.5 * hash(cx, cz, 43)) * DEN;
      const g = regionAt(hx, hz), pool = g && poolOf(g.n, date);
      if (!g || g.tier !== "playable" || !open.has(g.n) || !pool?.length || heightAt(w, hx, hz) <= 0.3) continue;
      const a = arenaOf(g);
      if (Math.hypot(hx - a.x, hz - a.z) < PAD_R * 3) continue; // the arena's doorstep is kept clear
      // It circles its den: a slow lap with the radius breathing in and out.
      const ph = hash(cx, cz, 44) * 6.283, spin = hash(cx, cz, 45) < 0.5 ? -1 : 1, ang = ph + spin * t * 0.05, rr = 14 + 8 * Math.sin(t * 0.11 + ph);
      const wx = hx + Math.cos(ang) * rr, wz = hz + Math.sin(ang) * rr;
      if (Math.hypot(wx - x, wz - z) > radius || heightAt(w, wx, wz) <= 0.1 || ownerAt(wx, wz) !== g.n) continue;
      const id = pool[Math.floor(hash(cx, cz, 46) * pool.length)]!;
      out.push({ den: `${cx},${cz}`, id, region: g.n, level: wildLevel(g.n, hash(cx, cz, 47)) + TIER_LEVEL[tierOf(id)], x: wx, z: wz, heading: ang + spin * Math.PI / 2 });
    }
  return out;
}

/** The wild creature you've walked into, if any: the nearest within reach whose den isn't calm. */
export function meet(me: Walker, wilds: readonly Wild[], calm: ReadonlySet<string>): Wild | undefined {
  let best: Wild | undefined, bd = MEET_R;
  for (const c of wilds) { const d = Math.hypot(c.x - me.x, c.z - me.z); if (d < bd && !calm.has(c.den)) { bd = d; best = c; } }
  return best;
}
