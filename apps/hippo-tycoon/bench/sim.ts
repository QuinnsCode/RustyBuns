// bun bench/sim.ts -> the game sim, TypeScript vs the Rust/wasm twin: ticks per
// second over full scripted rounds, heap growth, and the wasm's size.
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "bun";
import { join } from "node:path";
import { newState, step } from "../src/sim/step.ts";
import type { Input } from "../src/sim/types.ts";

const WASM = join(import.meta.dir, "../public/hippo_sim.wasm");
const ROUNDS = Number(process.argv[2] ?? 200);

function scripted(seed: number) {
  let x = seed >>> 0;
  const r = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  return (): Input[] => Array.from({ length: 4 }, () => ({ move: Math.round(r() * 2 - 1), gulp: r() < 0.12, bellow: r() < 0.01 }));
}

type StepFn = (s: ReturnType<typeof newState>, inputs: readonly Input[]) => unknown;
function run(label: string, stepFn: StepFn) {
  const once = () => { let ticks = 0; for (let r = 0; r < ROUNDS; r++) { const s = newState(r + 1, 90), inp = scripted(r); while (!s.over) { stepFn(s, inp()); ticks++; } } return ticks; };
  once();                                            // warm the JIT
  Bun.gc(true);
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const ticks = once();
  const ms = performance.now() - t0;
  const heap1 = process.memoryUsage().heapUsed;
  console.log(`${label.padEnd(26)} ${(ticks / ms * 1000 / 1e3).toFixed(0).padStart(6)}k ticks/s  ${(ms * 1000 / ticks).toFixed(2).padStart(6)} µs/tick  heap +${((heap1 - heap0) / 1048576).toFixed(1)} MB`);
}

console.log(`${ROUNDS} rounds of 90 s (2700 ticks each), 4 scripted seats`);
run("TypeScript step()", step);
if (existsSync(WASM)) {
  const { simFromWasm } = await import("../src/sim/native.ts");
  const bytes = readFileSync(WASM);
  const rs = await simFromWasm(bytes);
  run("Rust/wasm (state synced)", rs.step);
  run("Rust/wasm (state resident)", rs.residentStep());
  console.log(`wasm: ${bytes.length} B, ${gzipSync(bytes).length} B gzipped; linear memory ${rs.memoryBytes / 1024} KiB`);
} else console.log("(no public/hippo_sim.wasm; run `bun run build:native` for the Rust side)");
