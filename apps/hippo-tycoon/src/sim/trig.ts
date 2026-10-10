// cos and sin with nothing but + - * / and floor, so the Rust twin
// (rust/crates/hippo_sim) gets the same bits. Math.cos/sin/hypot are left to
// each engine's libm, whose last bits differ.

const HALF_PI = Math.PI / 2;

/** [cos a, sin a]. Accurate to about 1e-16 near the range the sim uses (0..2π). */
export function cosSin(a: number): [number, number] {
  const k = Math.floor(a / HALF_PI + 0.5);
  const r = a - k * HALF_PI, r2 = r * r;
  const s = r * (1 - r2 / 6 * (1 - r2 / 20 * (1 - r2 / 42 * (1 - r2 / 72 * (1 - r2 / 110 * (1 - r2 / 156 * (1 - r2 / 210)))))));
  const c = 1 - r2 / 2 * (1 - r2 / 12 * (1 - r2 / 30 * (1 - r2 / 56 * (1 - r2 / 90 * (1 - r2 / 132 * (1 - r2 / 182 * (1 - r2 / 240)))))));
  const q = ((k % 4) + 4) % 4;
  return q === 0 ? [c, s] : q === 1 ? [-s, c] : q === 2 ? [-c, -s] : [s, -c];
}

/** |(x, y)| as sqrt(x² + y²): sqrt is exactly rounded everywhere, Math.hypot is not. */
export const len = (x: number, y: number) => Math.sqrt(x * x + y * y);
