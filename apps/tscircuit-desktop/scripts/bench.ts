// bun scripts/bench.ts [traces]  : TS twin vs Rust (bun:ffi) on a synthetic board.
import { analyze } from "../src/analysis/analyze.ts";
import { analyzeNative } from "../desktop/native.ts";
import { syntheticBoard } from "./synthetic.ts";

const n = Number(process.argv[2] ?? 3000);
const els = syntheticBoard(n, 0.3);
const text = JSON.stringify(els);
const time = (f: () => unknown) => { const t = performance.now(); f(); return performance.now() - t; };
const ts = time(() => analyze(JSON.parse(text), 0.2));
const rs = time(() => analyzeNative(text, 0.2));
console.log(`${n} traces, ${(text.length / 1e6).toFixed(1)} MB JSON`);
console.log(`TypeScript: ${ts.toFixed(0)} ms`);
console.log(`Rust ffi:   ${rs.toFixed(0)} ms  (${(ts / rs).toFixed(1)}x)`);
