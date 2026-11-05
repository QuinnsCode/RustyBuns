// Where things sit in the one shared memory every worker searches, and the shape of the
// Rust exports. Browser-safe: no Bun imports.

/** Floats per vector (16 x 16 cells x 4 features), and the u64 words of its code. */
export const DIMS = 1024;
export const WORDS = DIMS / 64;
/** 32-bit words of one code: the TypeScript twin counts bits 32 at a time. */
export const WORDS32 = WORDS * 2;
export const MAX_K = 1024;
/** 1 GiB of 64 KiB pages: room for 8M codes. The wasm is linked with this as its max. */
export const MAX_PAGES = 16384;
/** Every wasm instance runs its own shadow stack in a slice of the module's 1 MiB one. */
export const STACK_SLICE = 32 * 1024;
export const MAX_WORKERS = 16;

/** What pixel_rag.wasm exports. All pointers are byte offsets into the shared memory. */
export interface PixelRagWasm {
  pr_embed(rgba: number, width: number, x: number, y: number, size: number, out: number): void;
  pr_dhash(rgba: number, width: number, x: number, y: number, size: number): bigint;
  pr_quantize(vecs: number, n: number, dims: number, out: number): void;
  pr_fill(out: number, count: number, seed: number): void;
  pr_topk(codes: number, start: number, end: number, words: number, query: number, k: number, outIdx: number, outDist: number): number;
  __stack_pointer: WebAssembly.Global;
  __heap_base: WebAssembly.Global;
}

const isFn = (x: unknown) => typeof x === "function";
/** The instance's exports, checked: a stale or foreign .wasm is refused rather than half-called. */
export function wasmExports(inst: WebAssembly.Instance): PixelRagWasm {
  const e = inst.exports;
  for (const k of ["pr_embed", "pr_dhash", "pr_quantize", "pr_fill", "pr_topk"]) if (!isFn(e[k])) throw new Error(`pixel_rag.wasm: no ${k}`);
  if (!(e.__stack_pointer instanceof WebAssembly.Global) || !(e.__heap_base instanceof WebAssembly.Global)) throw new Error("pixel_rag.wasm: not linked for a shared memory");
  return e as unknown as PixelRagWasm;
}

/**
 * The shared memory's regions, in bytes from `base` (past the wasm's own data and stack):
 *   codes    n x WORDS u64s, the index
 *   queries  one code per worker
 *   results  MAX_K row + MAX_K distance u32s per worker
 *   scratch  free for the caller (a tile's pixels, vectors to quantize)
 */
export interface Layout { base: number; n: number; codes: number; queries: number; results: number; scratch: number; end: number }
const align = (x: number, a = 64) => Math.ceil(x / a) * a;
export function layout(base: number, n: number, scratchBytes: number): Layout {
  const codes = align(base);
  const queries = align(codes + n * WORDS * 8);
  const results = align(queries + MAX_WORKERS * WORDS * 8);
  const scratch = align(results + MAX_WORKERS * MAX_K * 8);
  return { base, n, codes, queries, results, scratch, end: align(scratch + scratchBytes) };
}
/** Where worker `w` reads its query and writes its answer. */
export const queryAt = (l: Layout, w: number) => l.queries + w * WORDS * 8;
export const idxAt = (l: Layout, w: number) => l.results + w * MAX_K * 8;
export const distAt = (l: Layout, w: number) => idxAt(l, w) + MAX_K * 4;
