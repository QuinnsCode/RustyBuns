"use server";
// Runs on the desktop host: the same search over the same random codes, on Bun workers running
// the crate over bun:ffi (and the twin beside them), all pointed at one shared memory. The page
// sends a size, a seed and a query row; the host answers with its timings and its top hits, which
// the page checks against its own.
import { SharedIndex, type Engine } from "../engine/index.ts";
import { nativeLib } from "../engine/native.ts";
import { WORDS32 } from "../engine/layout.ts";

export interface HostRace { engine: string; workers: number; ms: number; best: number; hits: { row: number; dist: number }[]; platform: string; cores: number }

let cached: { n: number; seed: number; index: SharedIndex } | null = null;

export async function raceOnHost(n: number, seed: number, row: number, k: number, workers: number, lanes: Engine[]): Promise<HostRace> {
  if (!(await nativeLib()) && lanes.includes("native")) throw new Error("no Rust build for this platform (bun run build:native)");
  if (!cached || cached.n !== n || cached.seed !== seed) {
    cached?.index.stop();
    cached = { n, seed, index: await SharedIndex.create({ capacity: n, wasm: null }) };
    cached.index.fillRandom(seed);
  }
  const ix = cached.index;
  await ix.start(workers, lanes, () => new Worker(new URL("../engine/host-worker.ts", import.meta.url)));
  const q = ix.codes().slice(row * WORDS32, (row + 1) * WORDS32);
  q[0] ^= 1;
  const runs: number[] = [];
  let last = await ix.search(q, k);
  for (let i = 0; i < 5; i++) { last = await ix.search(q, k); runs.push(last.ms); }
  ix.stop();
  return {
    engine: lanes.join("+"), workers, ms: runs.reduce((a, b) => a + b) / runs.length, best: Math.min(...runs),
    hits: last.hits, platform: `${process.platform}-${process.arch}`, cores: navigator.hardwareConcurrency,
  };
}
