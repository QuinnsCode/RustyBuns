// Shape, the master EQ: it does what the curve says, never gets loud, Rust and
// TS agree, and the band list survives the wire. The Rust check skips (with a
// note) when the wasm isn't built.
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { TsEq, flatEq, response, type EqBand, type EqDoc } from "../src/engine/eq.ts";
import { WasmEq, instantiateFm } from "../src/engine/wasm.ts";
import { CEILING } from "../src/engine/params.ts";
import { apply, decodeOp, sanitize } from "../src/project.ts";
import { demoProject } from "../src/presets.ts";
import { newBand } from "../src/ui/Shape.tsx";

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

test("flat passes the mix untouched; a +30 dB bell stays under the ceiling", () => {
  const s = sine(220, 0.6);
  expect(run(flatEq(), s)).toEqual(s);
  const loud = run(doc(band({ g: 30, f: 220, q: 0.3 })), s);
  expect(loud.reduce((m, x) => Math.max(m, Math.abs(x)), 0)).toBeLessThanOrEqual(CEILING);
});

test("rust (wasm) matches ts sample for sample while bands move", async () => {
  const f = new URL("../public/fm_daw.wasm", import.meta.url);
  if (!existsSync(f)) { console.log("  (skipped: wasm not built; run `bun run build:native`)"); return; }
  const rust = new WasmEq(await instantiateFm(readFileSync(f)), SR), ts = new TsEq(SR);
  let seed = 1;
  const noise = new Float32Array(SR * 2).map(() => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5);
  const a = noise.slice(), b = noise.slice();
  const steps: EqDoc[] = [
    doc(band({ kind: "lowCut", f: 80, slope: 18, q: 2 }), band({ f: 900, g: 9, q: 3 }), band({ kind: "highShelf", f: 5000, g: -6 })),
    doc(band({ kind: "lowCut", f: 300, slope: 48 }), band({ f: 2000, g: -12, q: 0.5 }), null, band({ kind: "notch", f: 3000, q: 8 })),
    doc(null, band({ f: 2000, g: -12, q: 0.5, on: false }), null, band({ kind: "bandPass", f: 1200, q: 1.5 }), band({ kind: "highCut", f: 7000, slope: 96 })),
  ];
  const quarter = SR / 2;
  steps.forEach((d, k) => {
    rust.set(d); ts.set(d);
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
  const junk = sanitize({ ...next, eq: [{ kind: "laser", f: 1e9, g: "loud" }, 7, null, ...Array(20).fill(null)] })!.eq;
  expect(junk.length).toBe(8);
  expect(junk[0]).toEqual({ kind: "bell", f: 20000, g: 0, q: Math.SQRT1_2, slope: 12, on: true });
  expect(junk.slice(1)).toEqual(Array(7).fill(null));
});
