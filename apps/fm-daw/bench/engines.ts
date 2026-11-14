// Race the engines in the terminal: Rust over bun:ffi and TypeScript under Bun,
// on each built-in song (the same lanes as the app's "Race the engines" host row),
// then the circuit amp's rigs, Rust (wasm, as the AudioWorklet would run it) and TypeScript.
// `bun run bench [seconds]` (default 20 per song, a quarter of that per rig; Rust is "not built" until `bun run build:native`).
import { existsSync, readFileSync } from "node:fs";
import { benchOnHost } from "../src/actions/files.ts";
import { RIGS } from "../src/circuit/amps.ts";
import { Rig, type RigSpec } from "../src/circuit/rig.ts";
import { riff } from "../src/circuit/riff.ts";
import { WasmRig } from "../src/circuit/wasm.ts";
import { instantiateFm } from "../src/engine/wasm.ts";
import { SONGS } from "../src/songs.ts";

const seconds = Number(process.argv[2] ?? 20) || 20;
const x = (v: number | null) => (v === null ? "not built" : `${Math.round(v)}x realtime`);

const width = Math.max(...SONGS.map((s) => s.name.length)) + 2;
console.log(`Rendering ${seconds} s of each song at 48 kHz`);
for (const song of SONGS) {
  const h = await benchOnHost(song.make(), seconds);
  console.log(`${song.name.padEnd(width)} Rust ${x(h.rustX).padEnd(16)} TypeScript ${x(h.tsX)}  (${h.platform})`);
}

// The rigs: the guitar riff on a loop, 4x oversampled, as Q Amp runs them.
const SR = 48000, rigSeconds = Math.max(1, seconds / 4);
const loop = riff(SR), input = Float32Array.from({ length: SR * rigSeconds }, (_, i) => loop[i % loop.length]);
const wasm = new URL("../public/fm_daw.wasm", import.meta.url);
const exports = existsSync(wasm) ? await instantiateFm(readFileSync(wasm)) : null;
const time = (rig: { process(i: Float32Array, o: Float32Array): void }) => {
  const out = new Float32Array(input.length), t0 = performance.now();
  rig.process(input, out);
  return rigSeconds / ((performance.now() - t0) / 1000);
};
const one = (v: number | null) => (v === null ? "not built" : `${v.toFixed(1)}x realtime`);
const rigWidth = Math.max(...Object.keys(RIGS).map((k) => k.length)) + 2;
console.log(`\nRunning ${rigSeconds} s of the riff through each rig (4x oversampled)`);
for (const [name, spec] of Object.entries(RIGS) as [string, RigSpec][]) {
  let rustX: number | null = null;
  if (exports) { const r = new WasmRig(exports, spec, SR); rustX = time(r); r.free(); }
  const tsX = time(new Rig(spec, SR));
  const speedup = rustX === null ? "" : `  (${(rustX / tsX).toFixed(1)}x)`;
  console.log(`${name.padEnd(rigWidth)} Rust ${one(rustX).padEnd(16)} TypeScript ${one(tsX)}${speedup}`);
}
