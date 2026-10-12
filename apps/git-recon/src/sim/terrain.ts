// The ground a level is fought on. Two ways to get one, same interface:
//   heightmapTerrain  real terrain, the Park Hide & Seek zone format (Terrarium tiles, Int16 metres)
//   stampTerrain      authored ground, Druids Curse style: value noise plus stamps (ridges, plateaus, craters)
// and pads() flattens discs on either, so a folder's compound sits level on a hillside.
//
// Coordinates: x east, z south, y up (three.js's own), metres in game.

export interface Terrain {
  /** Radius of the playable disc. */
  readonly R: number;
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

export interface StampSpec { R: number; seed: number; amp: number; freq: number; stamps: Stamp[] }

/** Rolling noise (±amp) with the stamps summed on top. */
export function stampTerrain(spec: StampSpec): Terrain {
  const { R, seed, amp, freq, stamps } = spec;
  return {
    R,
    height(x, z) {
      const n = vnoise(seed, x * freq, z * freq) * 0.7 + vnoise(seed ^ 0x9e37, x * freq * 2.7 + 100, z * freq * 2.7 + 100) * 0.3;
      let h = (n - 0.5) * 2 * amp;
      for (const s of stamps) h += stampAt(s, x, z);
      return h;
    },
  };
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
