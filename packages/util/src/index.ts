export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Seeded PRNG: the same seed always gives the same stream of numbers in [0, 1). */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
