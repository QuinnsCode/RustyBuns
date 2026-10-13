// Stress the shared genome: Bun workers calling native Rust over FFI AND Bun workers
// running the same Rust as wasm all hammer ONE shared WebAssembly.Memory at once.
//   bun native/stress/genome.ts [--native 4] [--wasm 4] [--iters 2000000] [--genes 64]
import { dlopen, ptr } from "bun:ffi";
import { Worker } from "node:worker_threads";
import { NATIVE_LIB, PAGES, WASM_FILE, build, patchShared, symbols, type WorkerResult } from "./genome-lib";

export const FAILS = ["genes", "tally", "seq", "chromosome", "torn", "ops"] as const;

export type StressOpts = { native: number; wasm: number; iters: number; genes: number; seed?: bigint };
export type StressReport = {
  ok: boolean; failed: string[]; ops: number; ms: number; opsPerSec: number;
  seqlockTorn: number; racyTears: number; results: WorkerResult[];
};

export async function runGenomeStress(o: StressOpts): Promise<StressReport> {
  await build();
  const parts = o.native + o.wasm;
  const memory = new WebAssembly.Memory({ initial: PAGES, maximum: PAGES, shared: true });
  const wasm = await WebAssembly.instantiate(
    patchShared(new Uint8Array(await Bun.file(WASM_FILE).arrayBuffer())), { env: { memory } });
  const e = wasm.instance.exports as any;
  const slab: number = e.rb_genome_slab();
  const need = e.rb_genome_words(o.genes, parts);
  if (need > e.rb_genome_slab_words()) throw new Error(`genome needs ${need} words, slab has ${e.rb_genome_slab_words()}`);
  e.rb_genome_init(slab, o.genes, parts);

  const seed = o.seed ?? 0xC0FFEEn;
  const t0 = performance.now();
  const jobs = [...Array(parts)].map((_, id) => new Worker(new URL("./genome-worker.ts", import.meta.url), {
    workerData: { kind: id < o.native ? "native" : "wasm", memory, slab, genes: o.genes, parts, id, iters: o.iters, seed },
  }));
  const results = await Promise.all(jobs.map(w => new Promise<WorkerResult>((res, rej) => {
    w.once("message", res); w.once("error", rej);
  })));
  const ms = performance.now() - t0;

  // Judge it from BOTH sides: the wasm view and the native pointer view must agree.
  const expected = parts * o.iters;
  const failWasm: number = e.rb_genome_verify(slab, o.genes, parts, expected);
  const { symbols: s } = dlopen(NATIVE_LIB, symbols);
  const base = ptr(new Uint8Array(memory.buffer)) + slab;
  const failNative = s.rb_genome_verify(base, o.genes, parts, expected);
  const fail = failWasm | failNative;
  const failed = FAILS.filter((_, i) => fail & (1 << i));
  if (failWasm !== failNative) failed.push("views-disagree" as never);
  return {
    ok: failed.length === 0, failed, ops: expected, ms, opsPerSec: expected / (ms / 1000),
    seqlockTorn: results.reduce((a, r) => a + r.torn, 0), racyTears: s.rb_genome_racy_tears(base), results,
  };
}

if (import.meta.main) {
  const arg = (k: string, d: number) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : Number(process.argv[i + 1]); };
  const o = { native: arg("native", 4), wasm: arg("wasm", 4), iters: arg("iters", 2_000_000), genes: arg("genes", 64) };
  const r = await runGenomeStress(o);
  console.log(`genome: ${o.native} native + ${o.wasm} wasm workers x ${o.iters.toLocaleString()} ops, ${o.genes} genes`);
  for (const w of r.results) console.log(`  #${w.id} ${w.kind.padEnd(6)} ${w.ms.toFixed(0)}ms  seqlock tears ${w.torn}`);
  console.log(`  ${r.ops.toLocaleString()} ops in ${r.ms.toFixed(0)}ms (${(r.opsPerSec / 1e6).toFixed(1)}M ops/s)`);
  console.log(`  unguarded reads tore ${r.racyTears}x (proof the storm bites; the seqlock ones: ${r.seqlockTorn})`);
  console.log(r.ok ? "  PASS: every invariant held" : `  FAIL: ${r.failed.join(", ")}`);
  process.exit(r.ok ? 0 : 1);
}
