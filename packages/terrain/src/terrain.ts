// The ground a level is fought on. Two ways to get one, same interface:
//   heightmapTerrain  real terrain, the Park Hide & Seek zone format (Terrarium tiles, Int16 metres)
//   stampTerrain      authored ground, Druids Curse style: value noise plus stamps (ridges, plateaus, craters)
// and pads() flattens discs on either, so a folder's compound sits level on a hillside.
//
// Coordinates: x east, z south, y up (three.js's own), metres in game.

export interface Terrain {
  /** Radius of the playable disc. */
  readonly R: number;
  /** The water table: ground below it is under water (a pond). None on dry levels. */
  readonly water?: number;
  height(x: number, z: number): number;
}

/** Above this rise per metre the ground is a cliff: nobody walks up it. */
export const CLIFF = 1.1;

export function slope(t: Terrain, x: number, z: number, e = 0.6): number {
  return Math.hypot(t.height(x + e, z) - t.height(x - e, z), t.height(x, z + e) - t.height(x, z - e)) / (2 * e);
}

export const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/* ---------------- real ground ---------------- */

/** A zone as Park Hide & Seek commits it (src/zones/types.ts there); only the fields the ground needs. */
export interface ZoneData {
  id: string;
  name: string;
  center: [number, number];
  realRadius: number;
  n: number;
  /** n*n little-endian Int16 metres above sea level, base64; row 0 is the south edge. */
  heights: string;
}

/** Real ground shrunk `scale` times in every direction, its lowest point at 0. */
export function heightmapTerrain(data: ZoneData, scale: number): Terrain {
  const n = data.n, R = data.realRadius / scale, step = (2 * R) / (n - 1);
  const raw = new Int16Array(Uint8Array.from(atob(data.heights), (c) => c.charCodeAt(0)).buffer);
  let lo = Infinity;
  for (const v of raw) lo = Math.min(lo, v);
  const h = Float32Array.from(raw, (v) => (v - lo) / scale);
  return {
    R,
    height(x, z) {
      // Row 0 is south, and south is +z.
      const fx = Math.max(0, Math.min(n - 1.001, (x + R) / step));
      const fy = Math.max(0, Math.min(n - 1.001, (R - z) / step));
      const c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r, i = r * n + c;
      return h[i]! * (1 - tx) * (1 - ty) + h[i + 1]! * tx * (1 - ty) + h[i + n]! * (1 - tx) * ty + h[i + n + 1]! * tx * ty;
    },
  };
}

/* ---------------- authored ground ---------------- */

// Druids Curse's stamps (packages/sim/src/terrain.ts there), trimmed to the four
// a toy battlefield needs. h is metres up (+) or down (−); falloff is the edge
// width: 1-2 m reads as a cliff, 8+ m as a shoulder.
export type Stamp =
  | { kind: "ridge" | "valley"; x1: number; z1: number; x2: number; z2: number; w: number; h: number; falloff: number }
  | { kind: "plateau" | "crater"; x: number; z: number; r: number; h: number; falloff: number };

function segDist(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
  const dx = x2 - x1, dz = z2 - z1, len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : clamp01(((px - x1) * dx + (pz - z1) * dz) / len2);
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

export function stampAt(s: Stamp, x: number, z: number): number {
  let d: number, w: number;
  if ("x1" in s) d = segDist(x, z, s.x1, s.z1, s.x2, s.z2), w = s.w;
  else d = Math.hypot(x - s.x, z - s.z), w = s.r;
  if (d >= w + s.falloff) return 0;
  const t = d <= w ? 1 : 1 - smooth((d - w) / s.falloff);
  return (s.kind === "ridge" || s.kind === "plateau" ? s.h : -s.h) * t;
}

function hash2(seed: number, x: number, z: number): number {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

function vnoise(seed: number, x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), u = smooth(x - xi), v = smooth(z - zi);
  const c = (ix: number, iz: number) => (hash2(seed, ix, iz) & 0xffff) / 0xffff;
  const a = c(xi, zi), b = c(xi + 1, zi), d = c(xi, zi + 1), e = c(xi + 1, zi + 1);
  return a + (b - a) * u + (d - a) * v + (a - b - d + e) * u * v;
}

export interface StampSpec { R: number; seed: number; amp: number; freq: number; stamps: Stamp[]; water?: number }

/** Rolling noise (±amp) with the stamps summed on top, and water standing in anything below `water`. */
export function stampTerrain(spec: StampSpec): Terrain {
  const { R, seed, amp, freq, stamps, water } = spec;
  return {
    R,
    water,
    height(x, z) {
      const n = vnoise(seed, x * freq, z * freq) * 0.7 + vnoise(seed ^ 0x9e37, x * freq * 2.7 + 100, z * freq * 2.7 + 100) * 0.3;
      let h = (n - 0.5) * 2 * amp;
      for (const s of stamps) h += stampAt(s, x, z);
      return h;
    },
  };
}

/** Under water at (x, z): below the water table, if the level has one. */
export const wet = (t: Terrain, x: number, z: number) => t.water !== undefined && t.height(x, z) < t.water;

/**
 * Metres between contour lines for ground spanning lo..hi: a round 1-2-5 step
 * giving about a dozen lines, so a 2 m backyard and a 120 m cliff both read.
 */
export function contourStep(lo: number, hi: number, lines = 12): number {
  const raw = Math.max(0.1, (hi - lo) / lines), p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/* ---------------- level pads ---------------- */

export interface Pad { x: number; z: number; r: number }

/**
 * Settles each disc onto the ground's height at its centre, easing back to the
 * real slope over `skirt` metres: a shelf cut into the hill, not a pit.
 */
export function withPads(t: Terrain, pads: Pad[], skirt = 6): Terrain {
  const floors = pads.map((p) => t.height(p.x, p.z));
  return {
    R: t.R,
    water: t.water,
    height(x, z) {
      let h = t.height(x, z);
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i]!, d = Math.hypot(x - p.x, z - p.z);
        if (d >= p.r + skirt) continue;
        const k = d <= p.r ? 0 : smooth((d - p.r) / skirt);
        h = floors[i]! + (h - floors[i]!) * k;
      }
      return h;
    },
  };
}

/* ---------------- trails ---------------- */

/** A point on a trail, and what it's at: the ground is pulled to the trail's own profile within `width`, easing back over `skirt`. */
export interface TrailPoint { x: number; z: number; y: number }

/**
 * Cuts footpaths into the ground: along each polyline the surface is levelled across to the trail's
 * own profile (its points' heights, smoothed), so a path up a hill is a walkable shelf, not a scramble
 * across the slope. The influence is rasterised onto a one-metre grid once, so height() stays O(1).
 * `keep` (0..1) says how much of the ground underneath to leave as it is, say a shelf cut earlier.
 */
export function withTrails(t: Terrain, trails: TrailPoint[][], width = 3, skirt = 3, keep?: (x: number, z: number) => number): Terrain {
  if (!trails.length) return t;
  const cell = 1, n = Math.ceil((2 * t.R) / cell) + 1;
  // Per cell: how far off the nearest trail it is (the blend to the real ground comes from that), and the
  // trails' height there, every segment in reach weighing in by how near it is, so where two legs of a
  // path meet or pass close the shelf runs smoothly from one to the other.
  const near = new Float32Array(n * n).fill(Infinity), sumW = new Float32Array(n * n), sumWH = new Float32Array(n * n);
  const reach = width + skirt;
  for (const trail of trails) {
    for (let i = 0; i + 1 < trail.length; i++) {
      const a = trail[i]!, b = trail[i + 1]!, dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
      const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach + t.R) / cell)), c1 = Math.min(n - 1, Math.ceil((Math.max(a.x, b.x) + reach + t.R) / cell));
      const r0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach + t.R) / cell)), r1 = Math.min(n - 1, Math.ceil((Math.max(a.z, b.z) + reach + t.R) / cell));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const x = -t.R + c * cell, z = -t.R + r * cell;
        const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
        const d = Math.hypot(x - (a.x + dx * u), z - (a.z + dz * u));
        const i2 = r * n + c;
        if (d >= reach) continue;
        const w = (1 - d / reach) ** 6 + 1e-6;
        sumW[i2]! += w, sumWH[i2]! += w * (a.y + (b.y - a.y) * u);
        if (d < near[i2]!) near[i2] = d;
      }
    }
  }
  const at = (c: number, r: number, h: number) => {
    const i = r * n + c, d = near[i]!;
    if (d >= reach) return h;
    const kk = d <= width ? 0 : smooth((d - width) / skirt), floor = sumWH[i]! / sumW[i]!;
    return floor + (h - floor) * kk;
  };
  return {
    R: t.R,
    water: t.water,
    height(x, z) {
      const h = t.height(x, z), fc = (x + t.R) / cell, fr = (z + t.R) / cell;
      const c = Math.floor(fc), r = Math.floor(fr);
      if (c < 0 || r < 0 || c >= n - 1 || r >= n - 1) return h;
      const u = fc - c, v = fr - r;
      const h00 = at(c, r, h), h10 = at(c + 1, r, h), h01 = at(c, r + 1, h), h11 = at(c + 1, r + 1, h);
      const out = (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
      const kept = keep ? Math.max(0, Math.min(1, keep(x, z))) : 0;
      return kept > 0 ? h * kept + out * (1 - kept) : out;
    },
  };
}

/* ---------------- stamps on finished ground ---------------- */

/**
 * The ground with stamps summed on top of it: shell holes blown into a level once its pads and paths are
 * cut. The stamps are binned onto a coarse grid by their reach, so a height reads only the ones near it:
 * the game asks for the ground a hundred thousand times a second in a full battle.
 */
export function withStamps(t: Terrain, stamps: Stamp[], cell = 8): Terrain {
  if (!stamps.length) return t;
  const n = Math.ceil((2 * t.R) / cell) + 1, bins: Stamp[][] = Array.from({ length: n * n }, () => []);
  const col = (v: number) => Math.max(0, Math.min(n - 1, Math.floor((v + t.R) / cell)));
  for (const s of stamps) {
    const reach = ("x1" in s ? s.w : s.r) + s.falloff;
    const [x0, x1, z0, z1] = "x1" in s ? [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2), Math.min(s.z1, s.z2), Math.max(s.z1, s.z2)] : [s.x, s.x, s.z, s.z];
    for (let r = col(z0 - reach); r <= col(z1 + reach); r++) for (let c = col(x0 - reach); c <= col(x1 + reach); c++) bins[r * n + c]!.push(s);
  }
  return {
    R: t.R,
    water: t.water,
    height(x, z) {
      let h = t.height(x, z);
      for (const s of bins[col(z) * n + col(x)]!) h += stampAt(s, x, z);
      return h;
    },
  };
}
