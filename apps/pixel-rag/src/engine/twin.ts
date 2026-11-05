// The TypeScript twin of native/crates/pixel_rag: the same answers, bit for bit, for when the
// Rust can't load (no wasm build, an old browser) and to race against. Every float step goes
// through Math.fround in the crate's order, so f32 rounding matches exactly.
import { DIMS, MAX_K, WORDS32 } from "./layout.ts";

const f = Math.fround;
const GRID = 16;

function grid(rgba: Uint8Array, width: number, x: number, y: number, size: number, cols: number, rows: number, out: Float32Array) {
  for (let r = 0; r < rows; r++) {
    const y0 = y + Math.floor((r * size) / rows), y1 = Math.max(y + Math.floor(((r + 1) * size) / rows), y0 + 1);
    for (let c = 0; c < cols; c++) {
      const x0 = x + Math.floor((c * size) / cols), x1 = Math.max(x + Math.floor(((c + 1) * size) / cols), x0 + 1);
      let sum = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const p = (py * width + px) * 4;
          sum += (77 * rgba[p] + 150 * rgba[p + 1] + 29 * rgba[p + 2]) >> 8;
        }
      }
      out[r * cols + c] = f(sum / ((y1 - y0) * (x1 - x0) * 255));
    }
  }
}

/** The tile at (x, y), `size` px square, as DIMS floats: four blocks, each centred and scaled to unit L1. */
export function embed(rgba: Uint8Array, width: number, x: number, y: number, size: number, out = new Float32Array(DIMS)): Float32Array {
  const n = GRID * GRID;
  const lum = out.subarray(0, n);
  grid(rgba, width, x, y, size, GRID, GRID, lum);
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const i = r * GRID + c;
      const gx = f(lum[r * GRID + Math.min(c + 1, GRID - 1)] - lum[r * GRID + Math.max(c - 1, 0)]);
      const gy = f(lum[Math.min(r + 1, GRID - 1) * GRID + c] - lum[Math.max(r - 1, 0) * GRID + c]);
      out[n + i] = gx;
      out[2 * n + i] = gy;
      out[3 * n + i] = f(Math.abs(gx) + Math.abs(gy));
    }
  }
  for (let b = 0; b < DIMS; b += n) {
    let sum = 0;
    for (let i = b; i < b + n; i++) sum = f(sum + out[i]);
    const mean = f(sum / n);
    let l1 = 0;
    for (let i = b; i < b + n; i++) { out[i] = f(out[i] - mean); l1 = f(l1 + Math.abs(out[i])); }
    if (l1 > 0) for (let i = b; i < b + n; i++) out[i] = f(out[i] / l1);
  }
  return out;
}

/** A 64-bit difference hash of the tile. */
export function dhash(rgba: Uint8Array, width: number, x: number, y: number, size: number): bigint {
  const g = new Float32Array(72);
  grid(rgba, width, x, y, size, 9, 8, g);
  let h = 0n;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (g[r * 9 + c] < g[r * 9 + c + 1]) h |= 1n << BigInt(r * 8 + c);
  return h;
}

/** Vectors to codes: one bit per dimension, set when > 0, as u32 words (little end first). */
export function quantize(vecs: Float32Array, n: number, dims: number, out: Uint32Array) {
  const w32 = dims / 32;
  for (let i = 0; i < n; i++) {
    for (let w = 0; w < w32; w++) {
      let bits = 0;
      for (let b = 0; b < 32; b++) if (vecs[i * dims + w * 32 + b] > 0) bits |= 1 << b;
      out[i * w32 + w] = bits >>> 0;
    }
  }
}

/** xorshift32 from `seed`, the crate's pr_fill. */
export function fill(out: Uint32Array, seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  for (let i = 0; i < out.length; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    out[i] = s;
  }
}

function popcount(x: number) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** The crate's pr_topk over u32 views: nearest `k` rows in [start, end), ties to the lower row. */
export function topk(codes: Uint32Array, start: number, end: number, query: Uint32Array, k: number, outIdx: Uint32Array, outDist: Uint32Array): number {
  k = Math.min(k, MAX_K, Math.max(0, end - start));
  if (k === 0) return 0;
  let have = 0, worst = 0xffffffff;
  for (let r = start; r < end; r++) {
    let d = 0;
    const o = r * WORDS32;
    for (let j = 0; j < WORDS32; j++) d += popcount(codes[o + j] ^ query[j]);
    if (have === k && d >= worst) continue;
    let at = have < k ? have : k - 1;
    while (at > 0 && outDist[at - 1] > d) { outDist[at] = outDist[at - 1]; outIdx[at] = outIdx[at - 1]; at--; }
    outDist[at] = d; outIdx[at] = r;
    if (have < k) have++;
    if (have === k) worst = outDist[k - 1];
  }
  return have;
}
