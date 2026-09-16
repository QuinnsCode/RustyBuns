//! The smallest possible proof that both Rust paths work.
//! - `rb_add`: scalar in, scalar out.
//! - `rb_sum_f32`: pointer + length over a TypedArray. With a
//!   SharedArrayBuffer-backed Float32Array on the Bun side this is zero-copy:
//!   Bun workers and Rust read the same bytes.

/// Who owns the memory: the CALLER. Rust never frees `ptr`.
#[no_mangle]
pub extern "C" fn rb_add(a: i32, b: i32) -> i32 {
    a.wrapping_add(b)
}

/// # Safety
/// `ptr` must point to `len` readable f32s for the duration of the call.
#[no_mangle]
pub unsafe extern "C" fn rb_sum_f32(ptr: *const f32, len: usize) -> f32 {
    if ptr.is_null() { return 0.0; }
    std::slice::from_raw_parts(ptr, len).iter().sum()
}

#[cfg(feature = "wasm")]
mod wasm {
    use wasm_bindgen::prelude::*;
    #[wasm_bindgen]
    pub fn add(a: i32, b: i32) -> i32 { super::rb_add(a, b) }
    #[wasm_bindgen]
    pub fn sum_f32(v: &[f32]) -> f32 { v.iter().sum() }
}
