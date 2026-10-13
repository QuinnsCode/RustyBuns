import { dlopen, ptr } from "bun:ffi";
import { parentPort, workerData } from "node:worker_threads";
import { NATIVE_LIB, STACK_SLICE, WASM_FILE, patchShared, symbols, type WorkerJob, type WorkerResult } from "./genome-lib";

const job = workerData as WorkerJob;
const t0 = performance.now();
let torn: number;
if (job.kind === "native") {
  // Rust-over-FFI: a raw pointer into the very same bytes the wasm instances see.
  const { symbols: s } = dlopen(NATIVE_LIB, symbols);
  const base = ptr(new Uint8Array(job.memory.buffer)) + job.slab;
  torn = s.rb_genome_hammer(base, job.genes, job.parts, job.id, job.iters, job.seed);
} else {
  const mod = await WebAssembly.compile(patchShared(new Uint8Array(await Bun.file(WASM_FILE).arrayBuffer())));
  const inst = await WebAssembly.instantiate(mod, { env: { memory: job.memory } });
  const e = inst.exports as any;
  // They all import one memory, so without this every instance would share one shadow stack.
  e.__stack_pointer.value = (1 << 20) - job.id * STACK_SLICE;
  torn = e.rb_genome_hammer(job.slab, job.genes, job.parts, job.id, job.iters, job.seed);
}
parentPort!.postMessage({ id: job.id, kind: job.kind, torn, ms: performance.now() - t0 } satisfies WorkerResult);
