// The circuit-sim amp spike (CIRCUITS.md): a pedal drawn in tscircuit plays
// through the solver like the hand-written netlist, the solver lands on the
// textbook numbers, and no rig blows up on a hot input.
import { expect, setDefaultTimeout, test } from "bun:test";
import { Circuit, type Netlist } from "../src/circuit/mna.ts";
import { triodeStage } from "../src/circuit/circuits.ts";
import { RIGS } from "../src/circuit/amps.ts";
import { runRig } from "../src/circuit/rig.ts";
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
