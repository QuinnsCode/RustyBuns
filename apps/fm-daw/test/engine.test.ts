// The two promises this app makes: it never gets loud, and Rust and TS agree.
// Rust checks skip (with a note) when the crate isn't built, so contributors
// without cargo stay green.
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { TsEngine, type FmEngine } from "../src/engine/engine.ts";
import { WasmEngine, instantiateFm } from "../src/engine/wasm.ts";
import { createNativeEngine } from "../src/engine/native.ts";
import { renderPattern } from "../src/engine/sequencer.ts";
import { CEILING, NPARAMS, TRACKS, P } from "../src/engine/params.ts";
import { demoProject, randomPatch } from "../src/presets.ts";
import { audible, loopBeats, type Project } from "../src/project.ts";

const SR = 48000;

function load(engine: FmEngine, p: Project) {
  return (seq: import("../src/engine/sequencer.ts").Sequencer) => {
    p.tracks.forEach((t, ti) => { t.params.forEach((v, i) => engine.setParam(ti, i, v)); seq.setNotes(ti, t.notes); });
    seq.bpm = p.bpm; seq.setSwing(p.swing); seq.setLoopBeats(loopBeats(p)); seq.setAudible(audible(p));
    seq.metronome = true;
    engine.setMaster(0.5);
  };
}

const stats = (a: Float32Array) => {
  let peak = 0, finite = true;
  for (const x of a) { finite &&= Number.isFinite(x); peak = Math.max(peak, Math.abs(x)); }
  return { peak, finite };
};

test("demo groove: audible, finite, under the ceiling", () => {
  const e = new TsEngine(SR);
  const out = renderPattern(e, SR, 6, load(e, demoProject()));
  const { peak, finite } = stats(out);
  expect(finite).toBe(true);
  expect(peak).toBeGreaterThan(0.05);
  expect(peak).toBeLessThanOrEqual(CEILING);
});

test("a fresh engine is silent: every track starts at gain 0", () => {
  const e = new TsEngine(SR);
  e.setMaster(1);
  for (let t = 0; t < TRACKS; t++) e.noteOn(t, 1, 60, 1);
  const out = new Float32Array(4096);
  e.render(out, 2048);
  expect(stats(out).peak).toBe(0);
});

test("worst case: every param at its max, every voice on, master full -> still under the ceiling", () => {
  const e = new TsEngine(SR);
  e.setMaster(1);
  for (let t = 0; t < TRACKS; t++) {
    for (let i = 0; i < NPARAMS; i++) e.setParam(t, i, 1e12);
    e.setParam(t, P.ALGO, 3);
    for (let v = 0; v < 8; v++) e.noteOn(t, v, 20 + v * 12, 1);
  }
  const out = new Float32Array(SR * 2);
  e.render(out, SR);
  const { peak, finite } = stats(out);
  expect(finite).toBe(true);
  expect(peak).toBeLessThanOrEqual(CEILING);
});

test("garbage in (NaN, Infinity, negative, out of range) never reaches the output", () => {
  const e = new TsEngine(SR);
  e.setMaster(NaN);
  e.setMaster(1);
  for (let t = -1; t <= TRACKS; t++) for (let i = -1; i <= NPARAMS; i++) {
    e.setParam(t, i, NaN); e.setParam(t, i, Infinity); e.setParam(t, i, -1e9);
  }
  for (let t = 0; t < TRACKS; t++) { e.setParam(t, P.GAIN, 1); e.setParam(t, 1, 1); e.noteOn(t, 1, NaN, 1); e.noteOn(t, 2, 1e9, Infinity); e.noteOn(t, 3, 60, 1); }
  const out = new Float32Array(SR);
  e.render(out, SR / 2);
  expect(stats(out).finite).toBe(true);
  expect(stats(out).peak).toBeLessThanOrEqual(CEILING);
});

test("200 random patches stay finite and under the ceiling", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = demoProject();
  for (let k = 0; k < 200; k++) {
    const t = k % TRACKS;
    p.tracks[t].params = randomPatch(p.tracks[t].kind, p.tracks[t].params, rnd);
    if (k % 25 !== 24) continue;
    const e = new TsEngine(SR);
    const { peak, finite } = stats(renderPattern(e, SR, 2, load(e, p)));
    expect(finite).toBe(true);
    expect(peak).toBeLessThanOrEqual(CEILING);
  }
});

async function compare(name: string, make: () => Promise<FmEngine | null>) {
  const rust = await make();
  if (!rust) { console.log(`  (skipped: ${name} not built; run \`bun run build:native\`)`); return; }
  const p = demoProject();
  const a = renderPattern(rust, SR, 8, load(rust, p));
  rust.free?.();
  const ts = new TsEngine(SR);
  const b = renderPattern(ts, SR, 8, load(ts, p));
  let maxDiff = 0;
  for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  console.log(`  ${name}: max |rust - ts| = ${maxDiff.toExponential(2)} over ${a.length / 2} frames`);
  expect(maxDiff).toBeLessThan(1e-4);
}

test("rust (cdylib over bun:ffi) matches ts sample for sample", () => compare("cdylib", () => createNativeEngine(SR)));

test("rust (wasm, what the AudioWorklet runs) matches ts sample for sample", () => compare("wasm", async () => {
  const f = new URL("../public/fm_daw.wasm", import.meta.url);
  if (!existsSync(f)) return null;
  return new WasmEngine(await instantiateFm(readFileSync(f)), SR);
}));
