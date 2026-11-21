# Goose for small hot kernels: parked

Spike for [#5302](https://github.com/QuinnsCode/RustyBuns/issues/5302), 2026-11-21. Should
[Goose](https://github.com/aardappel/goose) (Apache 2.0, memory safe, no GC or heap, compiles to one
C file) sit next to Rust for small hot kernels? We ported `hippo_fluid`, the oil geyser's particle sim, and
tested it against the Rust crate and the TypeScript twin.

**Verdict: park.** The port was easy and its output matched bit for bit. With clang it was faster than
Rust. But the two reasons to pick it fail here:

- **No wasm.** `hippo_fluid` runs in the browser as wasm. Goose's runtime needs mmap, pthreads and
  signals, and its own design note (`docs/design/wasm.md`) says wasm "is a proposal and is not implemented".
- **The no-build path is slow.** Loading the C with `bun:ffi` `cc()` (TinyCC) runs 3.5x slower than the
  TypeScript twin. The fast path needs a clang build, which is the same build step cargo already is.

Look again if Goose gets a wasm target.

## What was run

- Goose built from source (`cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build`, about 2 min,
  C++20). We used main at `a5ab89f` (runtime `41e336e5d1ee`). Prebuilt releases exist too (latest `v2026.4`).
- The port has the same four exports: `fl_init`, `fl_step`, `fl_count`, `fl_out` (plus `fl_stride`).
  `goose --standalone --header hippo_fluid.h --include fl_shim.h -o hippo_fluid.c` turns 163 lines of Goose
  into 6,374 lines of C, because the whole runtime comes along.
- We ran the 400 scripted steps from `test/fluid.test.ts` (seed 11) through four engines: the TS twin, Rust
  (`rustc -C opt-level=3`, cdylib), Goose under TinyCC and Goose under clang. Every `fl_out` float was
  compared as raw u32 bits.

## Results

| | ms per `fl_step` (about 1,040 live particles, Apple Silicon) |
|---|---|
| TypeScript twin (Bun JIT) | 4.84 |
| Rust, `opt-level=3`, native | 3.63 |
| Goose to C to clang `-O2`, native | 3.14 |
| Goose to C to `bun:ffi` `cc()` (TinyCC) | 17.12 |

- **Bit for bit: yes.** All four engines agreed on every float over 400 steps (36,543 particle-steps).
  Goose's C has `#pragma fp_contract(off)`, so clang can't fuse `a*b+c` into one rounding.
  Without that, bit-for-bit results would break.
- TinyCC compiles the 6,374 lines in-process in 46 ms.

## How hard the port was

It took under an hour, and it type-checked on the first try (two "redundant `as`" warnings). It reads
almost line for line like the Rust, and no lifetimes were needed. Rough spots:

- **`fl_out` needs C.** An `export fn` can't return a pointer into Goose memory. A three-line
  `--include` shim takes the buffer through an `extern fn fl_publish(p: const f32&)` call in `fl_init` and
  hands it back as `fl_out()`.
- **Bun's TinyCC is missing `__atomic_add_fetch_8` and related helpers** that the Goose runtime calls
  (TinyCC normally gets them from libtcc1). A second small C file with single-threaded versions fixed it.
- The host must call `goose_init(0, NULL)` before the first export, and exports must stay on that thread.
- `%` is Euclidean in Goose. That's harmless here, since every operand is non-negative, but it's a trap
  when porting from Rust or TS.
