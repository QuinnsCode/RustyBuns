// Shape, the master EQ: it does what the curve says, never gets loud, Rust and
// TS agree, and the band list survives the wire. The Rust check skips (with a
// note) when the wasm isn't built.
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { TsEq, eqLane, flatEq, listenOf, response, type EqBand, type EqDoc } from "../src/engine/eq.ts";
import { TsEngine } from "../src/engine/engine.ts";
import { renderProject } from "../src/engine/offline.ts";
import { MASTER, Sequencer } from "../src/engine/sequencer.ts";
import { Take, loopBeats, punchLane } from "../src/project.ts";
import { WasmEq, instantiateFm } from "../src/engine/wasm.ts";
import { CEILING } from "../src/engine/params.ts";
import { apply, decodeOp, sanitize } from "../src/project.ts";
import { demoProject } from "../src/presets.ts";
import { newBand, qOfResoDb } from "../src/ui/Shape.tsx";

const SR = 48000;
const band = (b: Partial<EqBand>): EqBand => ({ kind: "bell", f: 1000, g: 0, q: 0.707, slope: 12, on: true, ...b });
const doc = (...bs: (EqBand | null)[]): EqDoc => flatEq().map((_, i) => bs[i] ?? null);
const sine = (hz: number, amp: number) => {
  const b = new Float32Array(SR * 2);
  for (let f = 0; f < SR; f++) b[f * 2] = b[f * 2 + 1] = amp * Math.sin((2 * Math.PI * hz * f) / SR);
  return b;
};
/** Level change in dB over the second half of one second, after the glide and ring-in. */
const gainDb = (before: Float32Array, after: Float32Array) => {
  let a = 0, b = 0;
  for (let i = SR; i < before.length; i++) { a += before[i] * before[i]; b += after[i] * after[i]; }
  return 10 * Math.log10(b / a);
};
const run = (d: EqDoc, input: Float32Array) => {
  const eq = new TsEq(SR), out = input.slice();
  eq.set(d);
  eq.process(out, out.length >> 1);
  return out;
};

test("the everyday chain: low cut, low shelf, bell bump and dip, notch, high shelf, high cut, each where the curve puts it", () => {
  const chain = doc(
    band({ kind: "lowCut", f: 40, slope: 24 }),
    band({ kind: "lowShelf", f: 150, g: -3 }),
    band({ kind: "bell", f: 400, g: -6, q: 2 }),
    band({ kind: "bell", f: 2500, g: 4, q: 1 }),
    band({ kind: "notch", f: 6000, q: 4 }),
    band({ kind: "highShelf", f: 9000, g: 2 }),
    band({ kind: "highCut", f: 16000, slope: 12 }),
  );
  const freqs = [25, 100, 400, 1000, 2500, 6000, 12000];
  const curve = response(chain, SR, freqs).db;
  const heard = freqs.map((f) => { const s = sine(f, 0.05); return gainDb(s, run(chain, s)); });
  // what you see is what you hear (the notch's centre is a hole, so compare it as one)
  heard.forEach((h, i) => expect(Math.max(h, -60)).toBeCloseTo(Math.max(curve[i], -60), 0));
  expect(heard[0]).toBeLessThan(-10); // rumble gone
  expect(heard[2]).toBeLessThan(-5);  // the mud dip
  expect(heard[4]).toBeGreaterThan(3.5); // the presence bump
  expect(heard[5]).toBeLessThan(-40); // the ring notched out
});

test("gentle and steep cuts: 3, 6, 9, 12 and 24 dB/oct fall that much per octave, -3 dB at the corner, and dragging a cut up rings its corner", () => {
  const at = (b: EqBand, f: number) => { const s = sine(f, 0.05); return gainDb(s, run(doc(b), s)); };
  for (const slope of [3, 6, 9, 12, 24]) {
    const lo = band({ kind: "lowCut", f: 2000, slope }), hi = band({ kind: "highCut", f: 125, slope });
    // three and four octaves past the corner, where every slope is on its asymptote (and far from Nyquist, which steepens a high cut)
    const fallLo = at(lo, 250) - at(lo, 125), fallHi = at(hi, 1000) - at(hi, 2000);
    expect({ slope, corner: Math.round(at(lo, 2000)), lo: Math.round(fallLo), hi: Math.round(fallHi) }).toEqual({ slope, corner: -3, lo: slope, hi: slope });
  }
  // up on the dot is a higher Q: a resonant peak at the corner instead of -3 dB
  const flat = band({ kind: "lowCut", f: 500, slope: 24 }), rung = band({ kind: "lowCut", f: 500, slope: 24, q: qOfResoDb(12) });
  expect(at(rung, 500)).toBeGreaterThan(at(flat, 500) + 9);
});

test("a bell up near Nyquist keeps its analog width: 15 kHz +12 dB, Q 2, heard where drawn", () => {
  const b = band({ f: 15000, g: 12, q: 2 }), a = 10 ** (12 / 40), k = 1 / (2 * a);
  const analog = (f: number) => { const w = f / 15000, r = 1 - w * w; return 10 * Math.log10((r * r + (k * a * a * w) ** 2) / (r * r + (k * w) ** 2)); };
  for (const f of [3750, 10000, 15000, 20000]) {
    const s = sine(f, 0.05), heard = gainDb(s, run(doc(b), s));
    expect(heard).toBeCloseTo(response(doc(b), SR, [f]).db[0], 1);
    expect(Math.abs(heard - analog(f))).toBeLessThan(0.5); // the bilinear bell was 1.9 dB short at 10 kHz
  }
});

test("hold a dot: only its range plays, after the EQ, and letting go brings the whole mix back", () => {
  const eq = new TsEq(SR), bell = band({ f: 2000, g: 6, q: 4 });
  eq.set(doc(bell));
  const level = (hz: number) => { const s = sine(hz, 0.05), out = s.slice(); eq.reset(); eq.process(out, out.length >> 1); return gainDb(s, out); };
  const open = level(2000);
  eq.listen(listenOf(bell));
  expect(level(2000)).toBeCloseTo(open, 0); // the bump itself, boost included
  expect(level(200)).toBeLessThan(-25);    // the rest of the mix is gone
  eq.listen(null);
  expect(level(200)).toBeCloseTo(0, 0);
  // a cut has no width of its own: listen around its corner
  expect(listenOf(band({ kind: "lowCut", f: 80, q: 4 }))).toEqual({ f: 80, q: 1 });
});

test("flat passes the mix untouched; a +30 dB bell stays under the ceiling", () => {
  const s = sine(220, 0.6);
  expect(run(flatEq(), s)).toEqual(s);
  const loud = run(doc(band({ g: 30, f: 220, q: 0.3 })), s);
  expect(loud.reduce((m, x) => Math.max(m, Math.abs(x)), 0)).toBeLessThanOrEqual(CEILING);
});

test("rust (wasm) matches ts sample for sample while bands move and a dot is held", async () => {
  const f = new URL("../public/fm_daw.wasm", import.meta.url);
  if (!existsSync(f)) { console.log("  (skipped: wasm not built; run `bun run build:native`)"); return; }
  const rust = new WasmEq(await instantiateFm(readFileSync(f)), SR), ts = new TsEq(SR);
  let seed = 1;
  const quarter = SR / 2, steps: EqDoc[] = [
    doc(band({ kind: "lowCut", f: 80, slope: 18, q: 2 }), band({ f: 900, g: 9, q: 3 }), band({ kind: "highShelf", f: 5000, g: -6 })),
    doc(band({ kind: "lowCut", f: 300, slope: 48 }), band({ f: 2000, g: -12, q: 0.5 }), null, band({ kind: "notch", f: 3000, q: 8 })),
    doc(null, band({ f: 2000, g: -12, q: 0.5, on: false }), null, band({ kind: "bandPass", f: 1200, q: 1.5 }), band({ kind: "highCut", f: 7000, slope: 96 })),
    doc(band({ kind: "lowCut", f: 200, slope: 3 }), null, null, null, band({ kind: "highCut", f: 3000, slope: 9 })),
  ];
  const noise = new Float32Array(steps.length * quarter * 2).map(() => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5);
  const a = noise.slice(), b = noise.slice();
  steps.forEach((d, k) => {
    rust.set(d); ts.set(d);
    // a dot held over the third step, let go on the fourth
    const held = k === 2 ? { f: 1500, q: 2 } : null;
    if (k >= 2) { rust.listen(held); ts.listen(held); }
    rust.process(a.subarray(k * quarter * 2), quarter);
    ts.process(b.subarray(k * quarter * 2), quarter);
  });
  let maxDiff = 0;
  for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  rust.free();
  console.log(`  eq: max |rust - ts| = ${maxDiff.toExponential(2)}`);
  expect(maxDiff).toBeLessThan(1e-5);
});

test("the EQ is saved with the project, sent as an op, and a bad shape off the wire comes in clean", () => {
  const p = demoProject();
  expect(p.eq).toEqual(flatEq());
  const d = doc(newBand(30, 0), newBand(1000, 4.26), newBand(17000, 0));
  expect(d.slice(0, 3).map((b) => b?.kind)).toEqual(["lowCut", "bell", "highCut"]);
  const op = decodeOp(JSON.parse(JSON.stringify({ t: "eq", bands: d })));
  expect(op).not.toBeNull();
  const next = apply(p, op!);
  expect(next.eq).toEqual(d);
  expect(sanitize(JSON.parse(JSON.stringify(next)))!.eq).toEqual(d);
  // an older project has no EQ; junk becomes flat or fitted, never a crash
  expect(sanitize({ ...next, eq: undefined })!.eq).toEqual(flatEq());
  const junk = sanitize({ ...next, eq: [{ kind: "laser", f: 1e9, g: "loud", slope: 10 }, 7, null, ...Array(20).fill(null)] })!.eq;
  expect(junk.length).toBe(8);
  expect(junk[0]).toEqual({ kind: "bell", f: 20000, g: 0, q: Math.SQRT1_2, slope: 9, on: true });
  expect(junk.slice(1)).toEqual(Array(7).fill(null));
});

test("automate a band: a move recorded on the master plays back in the bounce, and taking the band out takes its moves", () => {
  // the record path: a gain move on band 1 while recording becomes a lane on the master
  const p0 = { ...demoProject(), space: 0, eq: doc(band({ f: 1000, g: 0, q: 0.2 })) }, L = loopBeats(p0);
  const seq = new Sequencer(new TsEngine(SR), SR), take = new Take();
  seq.onMove = (m) => take.add(m);
  seq.recording = true; seq.play();
  seq.move(MASTER, eqLane(0, "g"), -30, 0);
  const [moved] = take.flush();
  expect(moved).toMatchObject({ track: MASTER, i: eqLane(0, "g") });
  // the hand held -30 for the first half of the loop, then let it back up
  const lane = punchLane([], moved.i, [[0, -30], [L / 2, -30], [L / 2, 0]]);
  const p = apply(p0, decodeOp(JSON.parse(JSON.stringify({ t: "eqAuto", lanes: lane })))!);
  expect(p.eqAuto).toEqual(lane);
  const secs = (L * 60) / p.bpm, half = Math.round((secs / 2) * SR);
  const auto = renderProject(new TsEngine(SR), p, SR, secs, 1), plain = renderProject(new TsEngine(SR), p0, SR, secs, 1);
  const db = (a: Float32Array, from: number, to: number) => { let e = 0; for (let i = from * 2; i < to * 2; i++) e += a[i] * a[i]; return 10 * Math.log10(e + 1e-12); };
  expect(db(auto, 0, half) - db(plain, 0, half)).toBeLessThan(-6);                   // ducked while the lane says -30
  expect(Math.abs(db(auto, half + SR / 10, 2 * half) - db(plain, half + SR / 10, 2 * half))).toBeLessThan(1); // back once it lets go
  // a removed band takes its lane with it, so the next band in that slot starts clean
  expect(apply(p, { t: "eq", bands: flatEq() }).eqAuto).toBeUndefined();
});
