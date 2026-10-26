// bun scripts/bench.ts [traces] [--brute]  : the engines side by side on a synthetic board.
// --brute adds the TS engine without the spatial index (every pair), for the "before".
import { existsSync, readFileSync } from "node:fs";
import { analyze } from "../src/analysis/analyze.ts";
import { loadWasm, runWasm } from "../src/analysis/wasm.ts";
import { analyzeNative } from "../desktop/native.ts";
import { syntheticBoard } from "./synthetic.ts";

const n = Number(process.argv[2] ?? 3000);
const els = syntheticBoard(n, 0.3);
const text = JSON.stringify(els);
const time = (f: () => unknown) => { const t = performance.now(); f(); return performance.now() - t; };
const wasmFile = new URL("../public/native/tsci_analysis.wasm", import.meta.url).pathname;
const wasm = existsSync(wasmFile) ? await loadWasm(readFileSync(wasmFile)) : null;

console.log(`${n} traces, ${(text.length / 1e6).toFixed(1)} MB JSON`);
const ts = time(() => analyze(JSON.parse(text), 0.2));
const row = (name: string, ms: number) => console.log(`${name.padEnd(22)}${ms.toFixed(0).padStart(7)} ms  (${(ts / ms).toFixed(1)}x)`);
if (process.argv.includes("--brute")) row("TypeScript, no index", time(() => analyze(JSON.parse(text), 0.2, true)));
row("TypeScript", ts);
if (wasm) row("Rust wasm (1 thread)", time(() => runWasm(wasm, text, 0.2)));
if (analyzeNative("[]", 0)) row("Rust native (bun:ffi)", time(() => analyzeNative(text, 0.2)));
