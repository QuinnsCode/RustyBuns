//! Pixel RAG's hot path: turn screenshot tiles into vectors, pack them to bits, and search them.
//!
//! One crate, every lane: a cdylib over bun:ffi on the desktop host, and wasm32 importing ONE
//! shared WebAssembly.Memory that every Web Worker in the page instantiates on. The index lives in
//! that memory once; each worker scans its own slice of rows and nothing is copied. Pointers are
//! byte offsets on wasm and real addresses natively; the code is the same.
//!
//! src/engine/twin.ts is the TypeScript twin and must give bit-identical answers: every float
//! step here is a plain f32 op in a fixed order (no fused multiply-add), which the twin mirrors
//! with Math.fround.
#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(not(target_arch = "wasm32"))]
pub mod infer;

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

/// Cells per side of the grid a tile is averaged into.
pub const GRID: usize = 16;
/// Floats per vector: luminance, x gradient, y gradient and edge strength per cell.
pub const DIMS: usize = GRID * GRID * 4;
/// The most neighbours one search returns.
pub const MAX_K: u32 = 1024;

#[inline]
fn luma(p: *const u8) -> u32 {
    // Integer weights, so the twin gets the same number without any float.
    unsafe { (77 * *p as u32 + 150 * *p.add(1) as u32 + 29 * *p.add(2) as u32) >> 8 }
}

/// Average luminance of the `cols` x `rows` grid over the `size` px square at (x, y), in [0, 1].
fn grid(rgba: *const u8, width: u32, x: u32, y: u32, size: u32, cols: usize, rows: usize, out: &mut [f32]) {
    for r in 0..rows {
        let y0 = y + (r as u32 * size) / rows as u32;
        let y1 = y + ((r as u32 + 1) * size) / rows as u32;
        for c in 0..cols {
            let x0 = x + (c as u32 * size) / cols as u32;
            let x1 = x + ((c as u32 + 1) * size) / cols as u32;
            let mut sum: u32 = 0;
            for py in y0..y1.max(y0 + 1) {
                for px in x0..x1.max(x0 + 1) {
                    sum += luma(unsafe { rgba.add(((py * width + px) * 4) as usize) });
                }
            }
            let count = (y1.max(y0 + 1) - y0) * (x1.max(x0 + 1) - x0);
            out[r * cols + c] = sum as f32 / (count * 255) as f32;
        }
    }
}

/// The tile at (x, y), `size` px square, of an RGBA image `width` px wide, as DIMS floats with
/// each of its four blocks centred and scaled to unit L1. A blank tile is all zeros.
#[no_mangle]
pub extern "C" fn pr_embed(rgba: *const u8, width: u32, x: u32, y: u32, size: u32, out: *mut f32) {
    let v = unsafe { core::slice::from_raw_parts_mut(out, DIMS) };
    let n = GRID * GRID;
    let (lum, rest) = v.split_at_mut(n);
    grid(rgba, width, x, y, size, GRID, GRID, lum);
    for r in 0..GRID {
        for c in 0..GRID {
            let i = r * GRID + c;
            let gx = lum[r * GRID + (c + 1).min(GRID - 1)] - lum[r * GRID + c.saturating_sub(1)];
            let gy = lum[(r + 1).min(GRID - 1) * GRID + c] - lum[r.saturating_sub(1) * GRID + c];
            rest[i] = gx;
            rest[n + i] = gy;
            rest[2 * n + i] = gx.abs() + gy.abs();
        }
    }
    // Each block centred on its own mean (so a bit says "brighter than this tile's average",
    // "edge here or not") and scaled to unit L1, so the four count the same in a rescore.
    for b in v.chunks_exact_mut(n) {
        let mut sum = 0f32;
        for f in b.iter() { sum += *f; }
        let mean = sum / n as f32;
        let mut l1 = 0f32;
        for f in b.iter_mut() { *f -= mean; l1 += f.abs(); }
        if l1 > 0.0 { for f in b.iter_mut() { *f /= l1; } }
    }
}

/// A 64-bit difference hash of the tile: equal hashes mean a re-crawl can skip re-embedding it.
#[no_mangle]
pub extern "C" fn pr_dhash(rgba: *const u8, width: u32, x: u32, y: u32, size: u32) -> u64 {
    let mut g = [0f32; 72];
    grid(rgba, width, x, y, size, 9, 8, &mut g);
    let mut h = 0u64;
    for r in 0..8 {
        for c in 0..8 {
            if g[r * 9 + c] < g[r * 9 + c + 1] { h |= 1 << (r * 8 + c); }
        }
    }
    h
}

/// `n` vectors of `dims` floats to `n` codes of dims/64 words: one bit per dimension, set when > 0.
#[no_mangle]
pub extern "C" fn pr_quantize(vecs: *const f32, n: u32, dims: u32, out: *mut u64) {
    let words = (dims / 64) as usize;
    let v = unsafe { core::slice::from_raw_parts(vecs, n as usize * dims as usize) };
    let o = unsafe { core::slice::from_raw_parts_mut(out, n as usize * words) };
    for i in 0..n as usize {
        for w in 0..words {
            let mut bits = 0u64;
            for b in 0..64 {
                if v[i * dims as usize + w * 64 + b] > 0.0 { bits |= 1 << b; }
            }
            o[i * words + w] = bits;
        }
    }
}

/// Fill `count` u32 words with xorshift32 from `seed`: the benchmark's random codes.
#[no_mangle]
pub extern "C" fn pr_fill(out: *mut u32, count: u32, seed: u32) {
    let o = unsafe { core::slice::from_raw_parts_mut(out, count as usize) };
    let mut s = if seed == 0 { 0x9e3779b9 } else { seed };
    for w in o.iter_mut() {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        *w = s;
    }
}

/// The `k` rows in [start, end) of `codes` (each `words` u64s) nearest to `query` by Hamming
/// distance, nearest first, ties to the lower row. Writes rows to `out_idx` and distances to
/// `out_dist` (k u32s each); returns how many it found.
#[no_mangle]
pub extern "C" fn pr_topk(
    codes: *const u64, start: u32, end: u32, words: u32, query: *const u64, k: u32,
    out_idx: *mut u32, out_dist: *mut u32,
) -> u32 {
    let k = k.min(MAX_K).min(end.saturating_sub(start)) as usize;
    if k == 0 { return 0; }
    let w = words as usize;
    let q = unsafe { core::slice::from_raw_parts(query, w) };
    let idx = unsafe { core::slice::from_raw_parts_mut(out_idx, k) };
    let dist = unsafe { core::slice::from_raw_parts_mut(out_dist, k) };
    let rows = unsafe { core::slice::from_raw_parts(codes.add(start as usize * w), (end - start) as usize * w) };
    let mut have = 0usize;
    let mut worst = u32::MAX;
    for (r, row) in rows.chunks_exact(w).enumerate() {
        let mut d = 0u32;
        for j in 0..w { d += (row[j] ^ q[j]).count_ones(); }
        if have == k && d >= worst { continue; }
        // Insert, keeping (dist, row) ascending. Rows arrive in order, so equal distances stay put.
        let mut at = if have < k { have } else { k - 1 };
        while at > 0 && dist[at - 1] > d {
            if at < k { dist[at] = dist[at - 1]; idx[at] = idx[at - 1]; }
            at -= 1;
        }
        dist[at] = d;
        idx[at] = start + r as u32;
        if have < k { have += 1; }
        if have == k { worst = dist[k - 1]; }
    }
    have as u32
}
