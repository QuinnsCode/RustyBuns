//! src/sim/rng.ts and src/sim/trig.ts, op for op, plus JavaScript's Math.round.

/// mulberry32, one step. Returns [0, 1).
pub fn next(rng: &mut u32) -> f64 {
    *rng = rng.wrapping_add(0x6d2b_79f5);
    let mut t = *rng;
    t = (t ^ (t >> 15)).wrapping_mul(t | 1);
    t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
    (t ^ (t >> 14)) as f64 / 4294967296.0
}

pub fn between(rng: &mut u32, lo: f64, hi: f64) -> f64 { lo + (hi - lo) * next(rng) }
pub fn int_between(rng: &mut u32, lo: i64, hi: i64) -> i64 { lo + (next(rng) * (hi - lo + 1) as f64).floor() as i64 }

pub fn pick(rng: &mut u32, weights: &[f64]) -> usize {
    let mut total = 0.0;
    for w in weights { total += w; }
    let mut r = next(rng) * total;
    for (i, w) in weights.iter().enumerate() { r -= w; if r < 0.0 { return i; } }
    weights.len() - 1
}

/// Math.round: halves go up, toward +infinity.
pub fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 { f + 1.0 } else { f }
}

const HALF_PI: f64 = core::f64::consts::PI / 2.0;

pub fn cos_sin(a: f64) -> (f64, f64) {
    let k = (a / HALF_PI + 0.5).floor();
    let r = a - k * HALF_PI;
    let r2 = r * r;
    let s = r * (1.0 - r2 / 6.0 * (1.0 - r2 / 20.0 * (1.0 - r2 / 42.0 * (1.0 - r2 / 72.0 * (1.0 - r2 / 110.0 * (1.0 - r2 / 156.0 * (1.0 - r2 / 210.0)))))));
    let c = 1.0 - r2 / 2.0 * (1.0 - r2 / 12.0 * (1.0 - r2 / 30.0 * (1.0 - r2 / 56.0 * (1.0 - r2 / 90.0 * (1.0 - r2 / 132.0 * (1.0 - r2 / 182.0 * (1.0 - r2 / 240.0)))))));
    match (k as i64).rem_euclid(4) { 0 => (c, s), 1 => (-s, c), 2 => (-c, -s), _ => (s, -c) }
}

pub fn len(x: f64, y: f64) -> f64 { (x * x + y * y).sqrt() }
