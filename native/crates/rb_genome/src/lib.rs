//! A "genome" in shared memory, built to be hammered by everyone at once.
//!
//! The same code runs as a native cdylib (bun:ffi, in Bun workers) and as wasm32
//! with atomics (in other workers), both pointing at ONE SharedArrayBuffer: the
//! wasm `WebAssembly.Memory({shared: true})`. Every access is an atomic on a u32
//! word, so the layout below is the whole contract.
//!
//! Layout (u32 words, from `base`):
//!   HEADER words: ops, bumps, writes, torn, seq, racy (tears seen by the deliberate
//!   no-seqlock reads: proof the hammer can actually tear, not an invariant)
//!   CHROMOSOME_LEN words: a seqlock-guarded record, all equal when consistent
//!   `genes` words: counters, hit by fetch_add
//!   `parts` words: one tally per participant, bumped only by its owner
//!
//! Invariants `rb_genome_verify` checks after the storm (see FAIL_* bits):
//!   sum(genes) == bumps, sum(tally) == ops, seq == 2 * writes (and even),
//!   chromosome words all equal, torn == 0 (seqlock reads never see a mix).
#![cfg_attr(target_arch = "wasm32", no_std)]

use core::sync::atomic::{fence, AtomicU32, Ordering::*};

const OPS: usize = 0;
const BUMPS: usize = 1;
const WRITES: usize = 2;
const TORN: usize = 3;
const SEQ: usize = 4;
const RACY: usize = 5;
const HEADER: usize = 6;
pub const HEADER_WORDS: usize = HEADER;
pub const CHROMOSOME_LEN: usize = 16;

pub const FAIL_GENES: u32 = 1;
pub const FAIL_TALLY: u32 = 2;
pub const FAIL_SEQ: u32 = 4;
pub const FAIL_CHROMOSOME: u32 = 8;
pub const FAIL_TORN: u32 = 16;
pub const FAIL_OPS: u32 = 32;

#[inline]
unsafe fn w<'a>(base: *mut u32, i: usize) -> &'a AtomicU32 {
    AtomicU32::from_ptr(base.add(i))
}

/// Size in u32 words of a genome with `genes` genes and `parts` participants.
#[no_mangle]
pub extern "C" fn rb_genome_words(genes: u32, parts: u32) -> u32 {
    (HEADER + CHROMOSOME_LEN) as u32 + genes + parts
}

/// # Safety
/// `base` must point to `rb_genome_words(genes, parts)` writable, 4-aligned u32s.
#[no_mangle]
pub unsafe extern "C" fn rb_genome_init(base: *mut u32, genes: u32, parts: u32) {
    for i in 0..rb_genome_words(genes, parts) as usize {
        w(base, i).store(0, SeqCst);
    }
}

#[inline]
fn next(s: &mut u64) -> u64 {
    // xorshift64*
    *s ^= *s >> 12;
    *s ^= *s << 25;
    *s ^= *s >> 27;
    s.wrapping_mul(0x2545F4914F6CDD1D)
}

/// Run `iters` random ops as participant `id`: 60% gene bump, 20% seqlock write
/// of the chromosome, 20% read of it (20% of those reads `racy`: no seqlock, so
/// tearing is visible on purpose). Returns the torn count seen by this call's
/// *seqlock* reads (should be 0); racy tears go to the RACY word.
///
/// # Safety
/// Same as `rb_genome_init`; the genome must already be initialised; `id < parts`.
#[no_mangle]
pub unsafe extern "C" fn rb_genome_hammer(
    base: *mut u32, genes: u32, parts: u32, id: u32, iters: u32, seed: u64,
) -> u32 {
    let _ = parts;
    let chrom = HEADER;
    let gene0 = HEADER + CHROMOSOME_LEN;
    let tally = gene0 + genes as usize + id as usize;
    let mut rng = seed ^ ((id as u64 + 1).wrapping_mul(0x9E3779B97F4A7C15)) | 1;
    let mut torn = 0u32;
    for _ in 0..iters {
        let r = next(&mut rng);
        match (r % 100) as u32 {
            0..=59 => {
                let g = (r >> 8) as usize % genes as usize;
                w(base, gene0 + g).fetch_add(1, Relaxed);
                w(base, BUMPS).fetch_add(1, Relaxed);
            }
            60..=79 => {
                // multi-writer seqlock: odd seq == locked
                let seq = w(base, SEQ);
                let s = loop {
                    let s = seq.load(Acquire);
                    if s & 1 == 0 && seq.compare_exchange_weak(s, s + 1, Acquire, Relaxed).is_ok() {
                        break s;
                    }
                    core::hint::spin_loop();
                };
                let v = (r >> 32) as u32;
                for i in 0..CHROMOSOME_LEN {
                    w(base, chrom + i).store(v, Relaxed);
                }
                seq.store(s + 2, Release);
                w(base, WRITES).fetch_add(1, Relaxed);
            }
            _ => {
                let racy = (r >> 40) % 5 == 0;
                let seq = w(base, SEQ);
                loop {
                    let s1 = if racy { 0 } else { seq.load(Acquire) };
                    if s1 & 1 == 1 { core::hint::spin_loop(); continue; }
                    let first = w(base, chrom).load(Relaxed);
                    let mut ok = true;
                    for i in 1..CHROMOSOME_LEN {
                        if w(base, chrom + i).load(Relaxed) != first { ok = false; }
                    }
                    if racy {
                        if !ok { w(base, RACY).fetch_add(1, Relaxed); }
                        break;
                    }
                    fence(Acquire);
                    if seq.load(Relaxed) != s1 { continue; } // a writer overlapped: retry
                    if !ok { torn += 1; w(base, TORN).fetch_add(1, Relaxed); }
                    break;
                }
            }
        }
        w(base, tally).fetch_add(1, Relaxed);
        w(base, OPS).fetch_add(1, Relaxed);
    }
    torn
}

/// Check every invariant; 0 means the genome survived. `expected_ops` is the sum
/// of all `iters` the participants were given.
///
/// # Safety
/// Same as `rb_genome_init`. Call only when all hammering is over.
#[no_mangle]
pub unsafe extern "C" fn rb_genome_verify(base: *mut u32, genes: u32, parts: u32, expected_ops: u32) -> u32 {
    let mut fail = 0;
    let ld = |i: usize| w(base, i).load(SeqCst);
    let gene0 = HEADER + CHROMOSOME_LEN;
    let gsum = (0..genes as usize).fold(0u32, |a, i| a.wrapping_add(ld(gene0 + i)));
    let tsum = (0..parts as usize).fold(0u32, |a, i| a.wrapping_add(ld(gene0 + genes as usize + i)));
    if gsum != ld(BUMPS) { fail |= FAIL_GENES; }
    if tsum != ld(OPS) { fail |= FAIL_TALLY; }
    if ld(OPS) != expected_ops { fail |= FAIL_OPS; }
    if ld(SEQ) & 1 == 1 || ld(SEQ) != ld(WRITES).wrapping_mul(2) { fail |= FAIL_SEQ; }
    let first = ld(HEADER);
    if (1..CHROMOSOME_LEN).any(|i| ld(HEADER + i) != first) { fail |= FAIL_CHROMOSOME; }
    if ld(TORN) != 0 { fail |= FAIL_TORN; }
    fail
}

/// wasm only: the genome lives in the module's own static memory, so JS asks
/// where (an offset into the shared `WebAssembly.Memory`) and native workers add
/// it to the buffer's address.
#[cfg(target_arch = "wasm32")]
mod slab {
    pub const SLAB_WORDS: usize = 1 << 16;
    #[repr(align(16))]
    pub struct Slab(pub core::cell::UnsafeCell<[u32; SLAB_WORDS]>);
    unsafe impl Sync for Slab {}
    pub static SLAB: Slab = Slab(core::cell::UnsafeCell::new([0; SLAB_WORDS]));

    #[no_mangle]
    pub extern "C" fn rb_genome_slab() -> *mut u32 { SLAB.0.get() as *mut u32 }
    #[no_mangle]
    pub extern "C" fn rb_genome_slab_words() -> u32 { SLAB_WORDS as u32 }

    #[panic_handler]
    fn panic(_: &core::panic::PanicInfo) -> ! { core::arch::wasm32::unreachable() }
}

/// Tears the deliberately unguarded reads saw (expected > 0 under load).
///
/// # Safety
/// Same as `rb_genome_init`.
#[no_mangle]
pub unsafe extern "C" fn rb_genome_racy_tears(base: *mut u32) -> u32 {
    w(base, RACY).load(SeqCst)
}
