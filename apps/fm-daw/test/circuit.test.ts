// The circuit-sim amp spike (CIRCUITS.md): a pedal drawn in tscircuit plays
// through the solver like the hand-written netlist, the solver lands on the
// textbook numbers, no rig blows up on a hot input, the power amp sags and blows
// with nothing on its jack, the mic darkens off the centre, and the Rust port plays
// what the TypeScript solver plays (skipped, with a note, when the wasm isn't built).
import { existsSync, readFileSync } from "node:fs";
import { expect, setDefaultTimeout, test } from "bun:test";
import { Circuit, type Netlist } from "../src/circuit/mna.ts";
import { triodeStage } from "../src/circuit/circuits.ts";
import { AMPS, DEFAULT_ROOM, PEDALS, RIGS, buildRig } from "../src/circuit/amps.ts";
import { cabIR, gainAt } from "../src/circuit/cab.ts";
import { B_PLUS } from "../src/circuit/power.ts";
import { Rig, runRig } from "../src/circuit/rig.ts";
import { riff } from "../src/circuit/riff.ts";
import { WasmRig } from "../src/circuit/wasm.ts";
import { instantiateFm } from "../src/engine/wasm.ts";
import { boardToNetlist } from "../src/circuit/tscircuit.ts";
import board from "./fixtures/hard-clip.circuit.json";

setDefaultTimeout(60_000);
const SR = 48000;
const sine = (hz: number, seconds: number, amp = 1) => Float32Array.from({ length: SR * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
/** Fails naming `what` and the value when it falls outside lo..hi. */
const inRange = (what: string, v: number, lo: number, hi: number) => expect([what, v >= lo && v <= hi ? "in range" : v]).toEqual([what, "in range"]);
const peak = (b: Float32Array, from = 0) => { let p = 0; for (let i = from; i < b.length; i++) p = Math.max(p, Math.abs(b[i])); return p; };

test("a pedal drawn in tscircuit plays like the hand-written netlist", () => {
  const net = boardToNetlist(board);
  expect(net.parts.filter((p) => p.kind === "D")).toHaveLength(2);
  const hand = runRig(RIGS["hard-clip"], sine(220, 0.2));
  const drawn = runRig({ ...RIGS["hard-clip"], links: [{ net }] }, sine(220, 0.2));
  expect(drawn.misses).toBe(0);
  let diff = 0;
  for (let i = 0; i < hand.out.length; i++) diff = Math.max(diff, Math.abs(hand.out[i] - drawn.out[i]));
  expect(diff).toBeLessThan(1e-6);
  // ×101 on a 0.3 V input would be 30 V; the diodes hold it under a volt.
  const p = peak(drawn.out, SR / 10);
  expect(p).toBeGreaterThan(0.3);
  expect(p).toBeLessThan(1);
  expect(() => boardToNetlist([{ type: "source_component", source_component_id: "x", ftype: "simple_inductor", name: "L1" }])).toThrow("L1: no model for simple_inductor");
});

/** Gain in dB of a circuit at `hz`, measured on the second half of 0.2 s of a small sine. */
function gainDb(net: Netlist, hz: number, sr = 192000, amp = 0.01): number {
  const c = new Circuit(net, sr);
  const rest = c.settle(0);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < sr * 0.2; i++) {
    const o = c.step(amp * Math.sin((2 * Math.PI * hz * i) / sr)) - rest;
    if (i > sr * 0.1) { lo = Math.min(lo, o); hi = Math.max(hi, o); }
  }
  return 20 * Math.log10((hi - lo) / (2 * amp));
}

test("the solver lands on the textbook numbers", () => {
  const rc: Netlist = { input: "in", output: "out", parts: [{ kind: "R", a: "in", b: "out", ohms: 1000 }, { kind: "C", a: "out", b: "gnd", farads: 1 / (2 * Math.PI * 1000 * 1000) }] };
  for (const [what, net, hz, lo, hi] of [
    ["RC low-pass at its corner: -3 dB", rc, 1000, -3.1, -2.9],
    ["12AX7, 100k plate, bypassed 1.5k cathode: about ×50", triodeStage({ rk: 1.5e3, ck: 22e-6 }), 1000, 33, 36],
    ["12AX7, unbypassed 10k cathode: about ×8", triodeStage({ rk: 10e3, ck: 0 }), 1000, 16, 19],
  ] as const) inRange(what, gainDb(net, hz), lo, hi);
  // The tube rests where the load line says: 300 V supply, 100k plate load, ~0.8 mA.
  const c = new Circuit(triodeStage({ rk: 1.5e3, ck: 22e-6 }), 192000);
  inRange("plate at rest", c.settle(0), 190, 240);
});

test("every rig stays finite, bounded and converged on a hot input", () => {
  const hot = sine(110, 0.25, 1).map((v, i) => v + 0.5 * Math.sin((2 * Math.PI * 3000 * i) / SR));
  for (const [name, spec] of Object.entries(RIGS)) {
    const run = runRig(spec, hot);
    expect([name, run.misses]).toEqual([name, 0]);
    expect([name, Number.isFinite(peak(run.out))]).toEqual([name, true]);
    inRange(name, peak(run.out), 0.01, 200);
  }
});

const rms = (b: Float32Array, from = 0) => { let s = 0; for (let i = from; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / (b.length - from)); };
const brit = AMPS[0];

test("the power amp sags when you dig in: a loud chord compresses, a quiet one doesn't", () => {
  // The same amp with a stiff supply and with its own; the ratio of what comes out is the compression.
  const stiff = { ...buildRig(brit, brit.knobs), output: { pairs: 1, sag: 0, load: 8 } };
  for (const [what, level, lo, hi] of [["picked softly", 0.005, 0.98, 1.01], ["dug in", 1, 0.5, 0.93]] as const) {
    const input = sine(110, 0.5, level), soft = new Rig(buildRig(brit, brit.knobs), SR), out = new Float32Array(input.length);
    let low = B_PLUS;
    for (let i = 0; i < input.length; i += 128) { soft.process(input.subarray(i, i + 128), out.subarray(i, i + 128), Math.min(128, input.length - i)); low = Math.min(low, soft.supply); }
    inRange(`${what}: sagged over stiff`, rms(out, SR / 4) / rms(runRig(stiff, input).out, SR / 4), lo, hi);
    if (level === 1) inRange("the supply under a loud chord", low, 300, 430);
  }
});

test("nothing on the speaker jack: silent, survives the hiss, blows when played", () => {
  const open = buildRig(brit, { ...brit.knobs, noise: 5 }, undefined, { ...DEFAULT_ROOM, load: 0 });
  const rig = new Rig(open, SR), out = new Float32Array(SR / 2);
  rig.process(new Float32Array(SR / 2), out);
  expect([rig.fault, peak(out)]).toEqual([null, 0]);
  rig.process(sine(220, 0.5, 0.3), out);
  expect([rig.fault, peak(out)]).toEqual(["open-load", 0]);
  // Plugging the speaker in afterwards doesn't mend it; a mended amp (a new rig) plays.
  rig.setLoad(8);
  rig.process(sine(220, 0.5, 0.3), out);
  expect(peak(out)).toBe(0);
  inRange("the same amp with a speaker", peak(runRig({ ...open, output: { ...open.output!, load: 8 } }, sine(220, 0.5, 0.3)).out), 5, 100);
});

test("the mic on the cab: bright on the centre cap, darker at the edge and off axis", () => {
  const top = (at: number, angle: number) => { const ir = cabIR({ at, angle }, SR); return gainAt(ir, 5000, SR) / gainAt(ir, 800, SR); };
  const centre = top(0, 0), edge = top(1, 0), away = top(1, 60);
  expect([centre > 2 * edge, edge > away]).toEqual([true, true]);
  // Moving it while the amp plays is just a new response: no rebuild, no misses.
  const rig = new Rig(RIGS.lead, SR), out = new Float32Array(SR / 4);
  rig.process(sine(220, 0.25), out);
  rig.setMic({ at: 1, angle: 60 });
  rig.process(sine(220, 0.25), out);
  expect(rig.misses).toBe(0);
});

test("rust (wasm) plays every rig like ts, while the knobs turn", async () => {
  const f = new URL("../public/fm_daw.wasm", import.meta.url);
  if (!existsSync(f)) { console.log("  (skipped: wasm not built; run `bun run build:native`)"); return; }
  const x = await instantiateFm(readFileSync(f));
  const input = riff(SR).subarray(0, SR / 2), half = SR / 4;
  const lead = AMPS[1], fuzz = PEDALS[1];
  const rigs = {
    ...RIGS,
    "fuzz into lead, hissing": buildRig(lead, { ...lead.knobs, noise: 7 }, { def: fuzz, drive: 6 }),
    "brit with nothing on the jack": buildRig(AMPS[0], AMPS[0].knobs, undefined, { ...DEFAULT_ROOM, load: 0 }),
  };
  for (const [name, spec] of Object.entries(rigs)) {
    const ts = new Rig(spec, SR), rust = new WasmRig(x, spec, SR);
    const a = new Float32Array(input.length), b = new Float32Array(input.length);
    ts.process(input, a, half); rust.process(input, b, half);
    // Halfway: every knob Q Amp turns live (a pot, the power drive, the hiss, a rebuilt circuit, the mic), and a 16 ohm cab.
    const last = spec.links.length - 1;
    for (const r of [ts, rust]) {
      r.setGain(last, 0.5); r.setPower(spec.power ? 3 : 0); r.setNoise(2); r.setLink(0, spec.links[0].net);
      if (spec.cab) r.setMic({ at: 0.8, angle: 30 });
      if (spec.output?.load) r.setLoad(16);
    }
    ts.process(input.subarray(half), a.subarray(half)); rust.process(input.subarray(half), b.subarray(half));
    let diff = 0, top = 0;
    for (let i = 0; i < a.length; i++) { diff = Math.max(diff, Math.abs(a[i] - b[i])); top = Math.max(top, Math.abs(a[i])); }
    console.log(`  ${name}: max |rust - ts| = ${diff.toExponential(2)} (peak ${top.toFixed(2)} V)`);
    expect([name, rust.misses, rust.levels().length, rust.fault]).toEqual([name, ts.misses, spec.links.length, ts.fault]);
    expect([name, diff <= 1e-6 * top]).toEqual([name, true]);
    rust.free();
  }
});
