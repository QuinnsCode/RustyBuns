// mulberry32: tiny, fast, and the same everywhere. State is one uint32 kept on
// the object that owns it, so a snapshot of the sim includes its randomness.

export interface Rng { rng: number }

export function seedOf(seed: number): number {
  return (seed ^ 0x9e3779b9) >>> 0;
}

/** Uniform in [0, 1). */
export function next(o: Rng): number {
  o.rng = (o.rng + 0x6d2b79f5) >>> 0;
  let t = o.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const between = (o: Rng, lo: number, hi: number) => lo + (hi - lo) * next(o);
export const intBetween = (o: Rng, lo: number, hi: number) => lo + Math.floor(next(o) * (hi - lo + 1));

/** Index into a weight table. */
export function pick(o: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = next(o) * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]!; if (r < 0) return i; }
  return weights.length - 1;
}
