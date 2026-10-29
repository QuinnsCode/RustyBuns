export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** |(x, y)| as sqrt(x² + y²): several times cheaper than Math.hypot, and exactly rounded on every engine. */
export const len = (x: number, y: number) => Math.sqrt(x * x + y * y);
/** |(x, y, z)|, the same way. */
export const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
/** Text made safe to put in HTML, attributes included. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The next number in [0, 1) of a mulberry32 stream whose state is `o[key]`, a uint32 kept on the object that
 * owns it, so a snapshot of a sim includes its randomness.
 */
export function nextRandom<K extends string>(o: Record<K, number>, key: K): number {
  let t = (o[key] = (o[key] + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Seeded PRNG: the same seed always gives the same stream of numbers in [0, 1). */
export function mulberry32(seed: number) {
  const s = { a: seed >>> 0 };
  return () => nextRandom(s, "a");
}

/**
 * A thumb stick's push as two axes in [-1, 1], screen directions (x right, y down): a thumb offset from the
 * stick's centre in pixels, clamped to the rim at `radius`, with a dead zone of `dead` of the radius round the centre.
 */
export function stickAxes(dx: number, dy: number, radius: number, dead = 0.18): { x: number; y: number } {
  const len = Math.hypot(dx, dy), k = len > radius ? radius / len : 1;
  const axis = (v: number) => {
    const a = clamp((v * k) / radius, -1, 1);
    return Math.abs(a) < dead ? 0 : a;
  };
  return { x: axis(dx) || 0, y: axis(dy) || 0 };
}

export * from "./sweep.ts";
