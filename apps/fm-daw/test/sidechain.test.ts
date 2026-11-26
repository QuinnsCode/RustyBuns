// The sidechain in the engine: the bass and the pad ducked under the kick, Rust and TS alike, and the pad pumping.
// Its own file so engine.test.ts's heavy Rust renders keep their own time budget.
import { test, expect } from "bun:test";
import { TsEngine, type FmEngine } from "../src/engine/engine.ts";
import { createNativeEngine } from "../src/engine/native.ts";
import { renderPattern, type Sequencer } from "../src/engine/sequencer.ts";
import { TRACKS, P } from "../src/engine/params.ts";
import { demoProject } from "../src/presets.ts";
import { audible, loopBeats, type Project } from "../src/project.ts";

const SR = 48000;
const HEAVY = 60_000;

const load = (engine: FmEngine, p: Project) => (seq: Sequencer) => {
  p.tracks.forEach((t, ti) => { t.params.forEach((v, i) => engine.setParam(ti, i, v)); seq.setNotes(ti, t.notes); });
  seq.bpm = p.bpm; seq.setSwing(p.swing); seq.setLoopBeats(loopBeats(p)); seq.setAudible(audible(p));
  engine.setMaster(0.5);
};

/** The demo groove with the bass (track 6) and the pad (track 8) ducked under the kick (track 1): the kick pumping them. */
function pumped(depth = 1): Project {
  const p = demoProject();
  const duck = (t: Project["tracks"][number], ti: number) => (ti === 5 || ti === 7 ? { ...t, params: t.params.map((v, i) => (i === P.DUCK_FROM ? 1 : i === P.DUCK ? depth : v)) } : t);
  return { ...p, tracks: p.tracks.map(duck) };
}

test("rust matches ts on the sidechain (the bass and the pad ducking under the kick)", async () => {
  const rust = await createNativeEngine(SR);
  if (!rust) { console.log("  (skipped: cdylib not built; run `bun run build:native`)"); return; }
  const p = pumped();
  const a = renderPattern(rust, SR, 4, load(rust, p));
  rust.free?.();
  const ts = new TsEngine(SR);
  const b = renderPattern(ts, SR, 4, load(ts, p));
  let maxDiff = 0;
  for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  console.log(`  cdylib, sidechain: max |rust - ts| = ${maxDiff.toExponential(2)} over ${a.length / 2} frames`);
  expect(maxDiff).toBeLessThan(1e-4);
}, HEAVY);

test("a track ducked under the kick dips on every kick and comes back between them", () => {
  const PAD = 7;
  const beat = (60 / demoProject().bpm) * SR;
  // the pad's first long chord (beats 1 to 3): the 30 ms after each kick against 30 ms three quarters on
  const BEATS = [1, 2, 3];
  const seconds = (BEATS.at(-1)! + 1) * beat / SR;
  // the pad alone, as its Shape's spectrum hears it (a copy of its chunk), through the groove as the bounce plays it
  const padOf = (p: Project) => {
    const e = new TsEngine(SR), got: number[] = [];
    renderPattern(e, SR, seconds, (seq) => { load(e, p)(seq); e.setTap(PAD, "listen"); },
      undefined, (_, n, taps) => { for (let f = 0; f < n; f++) got.push(taps![f * TRACKS + PAD]); }, true);
    return got;
  };
  const rms = (a: number[], from: number, len: number) => Math.sqrt(a.slice(from, from + len).reduce((s, x) => s + x * x, 0) / len);
  const pump = (a: number[]) => BEATS.map((b) => rms(a, Math.round(b * beat), SR * 0.03) / rms(a, Math.round((b + 0.75) * beat), SR * 0.03));
  // each beat against the same beat with no sidechain (the pad swells on its own)
  const dry = pump(padOf(demoProject()));
  const dip = (depth: number) => pump(padOf(pumped(depth))).map((r, i) => r / dry[i]);
  const full = dip(1), half = dip(0.5);
  console.log(`  the pad on a kick against between, to the dry pad: full ${full.map((x) => x.toFixed(2))}, half ${half.map((x) => x.toFixed(2))}`);
  for (const r of full) expect(r).toBeLessThan(0.3);
  // half the depth: a dip you hear, not a gap
  for (const r of half) { expect(r).toBeGreaterThan(0.4); expect(r).toBeLessThan(0.85); }
}, HEAVY);
