//! Pocket Dice's roller as a wasm module the page loads with plain `WebAssembly.instantiate`: three exported
//! functions, numbers in and out, no memory to share and no glue. `next` is mulberry32 step for step with
//! `nextRandom` in packages/util/src/index.ts, so a seed rolls the same dice here and in the TS fallback.

use core::sync::atomic::{AtomicU32, Ordering::Relaxed};

/// One step of mulberry32 on `state`: the next number in [0, 1).
pub fn step(state: &mut u32) -> f64 {
    *state = state.wrapping_add(0x6d2b_79f5);
    let s = *state;
    let mut t = (s ^ (s >> 15)).wrapping_mul(s | 1);
    t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
    (t ^ (t >> 14)) as f64 / 4_294_967_296.0
}

/// A die with `sides` faces, from 1 to `sides`.
pub fn face(state: &mut u32, sides: u32) -> u32 {
    1 + (step(state) * sides as f64) as u32
}

// The module's one stream. wasm32-unknown-unknown runs on one thread, so an atomic is just a safe static.
static STATE: AtomicU32 = AtomicU32::new(0);

/// Starts the stream at `s`.
#[no_mangle]
pub extern "C" fn seed(s: u32) {
    STATE.store(s, Relaxed);
}

/// The next number in [0, 1).
#[no_mangle]
pub extern "C" fn next() -> f64 {
    let mut s = STATE.load(Relaxed);
    let r = step(&mut s);
    STATE.store(s, Relaxed);
    r
}

/// The next die with `sides` faces.
#[no_mangle]
pub extern "C" fn roll(sides: u32) -> u32 {
    let mut s = STATE.load(Relaxed);
    let r = face(&mut s, sides);
    STATE.store(s, Relaxed);
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    // mulberry32(42)'s first three numbers as @rustybuns/util gives them.
    #[test]
    fn matches_the_ts_stream() {
        let mut s = 42;
        let got: Vec<f64> = (0..3).map(|_| step(&mut s)).collect();
        assert_eq!(got, TS_42);
    }

    #[test]
    fn faces_stay_on_the_die() {
        let mut s = 7;
        assert!((0..10_000).all(|_| (1..=6).contains(&face(&mut s, 6))));
    }

    const TS_42: [f64; 3] = [0.6011037519201636, 0.44829055899754167, 0.8524657934904099];
}
