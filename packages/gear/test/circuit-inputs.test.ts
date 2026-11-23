// The circuit solver past its one input: supplies driven as it plays (a mixer's channels), a current source pushed
// each sample (an OTA's bias pin), a pot folded into resistors and the circuit built again without losing its
// capacitors' charge; and a linear circuit's gains worked out from its netlist instead of solved sample by sample.
import { expect, test } from "bun:test";
import { Circuit, fixPots, gains, type Netlist, type Part } from "../src/circuit/index.ts";

/** An inverting summer, out = -(a + 2b), and a current source into 10k beside it. */
const SUMMER: Part[] = [
  { kind: "R", a: "A", b: "SUM", ohms: 100e3 }, { kind: "R", a: "B", b: "SUM", ohms: 50e3 }, { kind: "R", a: "OUT", b: "SUM", ohms: 100e3 },
  { kind: "Opamp", plus: "gnd", minus: "SUM", out: "OUT", rail: 0 },
];

test("a summer's second input driven and a bias current pushed, sample by sample", () => {
  const net: Netlist = { input: "A", output: "OUT", parts: [...SUMMER, { kind: "V", a: "B", b: "gnd", volts: 0 }, { kind: "I", a: "gnd", b: "BIAS", amps: 0 }, { kind: "R", a: "BIAS", b: "gnd", ohms: 10e3 }] };
  const c = new Circuit(net, 48000);
  c.settle(0);
  const b = c.supplyAt("B"), bias = c.sourceInto("BIAS");
  const played = ([a, vb, amps]: number[]) => {
    c.drive(b, vb);
    c.push(bias, amps);
    let out = 0;
    for (let i = 0; i < 200; i++) out = c.step(a);
    return [out, c.volts("BIAS")].map((v) => Math.round(v * 1000) / 1000);
  };
  expect([[1, 0, 0], [0, 1, 1e-4], [0.5, -0.25, 2e-4]].map(played)).toEqual([[-1, 0], [-2, 1], [0, 2]]);
});

test("a pot moved by building the circuit again carries its capacitor's charge on", () => {
  const rc = (at: number): Netlist => fixPots({ input: "IN", output: "CAP", parts: [{ kind: "Pot", a: "IN", w: "CAP", b: "CAP", ohms: 100e3, at }, { kind: "C", a: "CAP", b: "gnd", farads: 1e-6 }] });
  const slow = new Circuit(rc(0.5), 48000);
  slow.settle(0);
  let v = 0;
  for (let i = 0; i < 1200; i++) v = slow.step(1); // 25 ms on 50k and 1 uF: 1 - e^-0.5
  expect(v).toBeCloseTo(1 - Math.exp(-0.5), 2);
  const fast = new Circuit(rc(0.1), 48000);
  expect(fast.adopt(slow)).toBe(true);
  expect(fast.step(1)).toBeCloseTo(v, 2);
  for (let i = 0; i < 2400; i++) v = fast.step(1); // 50 ms more on 10k: five time constants
  expect(v).toBeCloseTo(1 - (1 - 0.393) * Math.exp(-5), 2);
  // Another circuit altogether takes nothing.
  expect(new Circuit({ input: "A", output: "OUT", parts: SUMMER }, 48000).adopt(slow)).toBe(false);
});

test("a linear circuit's gains and offsets from its netlist, and a part that bends refused", () => {
  const g = gains({ parts: [...SUMMER, { kind: "V", a: "V12", b: "gnd", volts: 12 }, { kind: "R", a: "V12", b: "SUM", ohms: 1.2e6 }] }, ["A", "B"], ["OUT"]);
  expect(g.gain[0].map((x) => Math.round(x * 1e4) / 1e4)).toEqual([-1, -2]);
  expect(g.offset[0]).toBeCloseTo(-1, 4);
  // A pot as a divider, a quarter of the way up from ground: a quarter of the input.
  const pot = gains({ parts: [{ kind: "Pot", a: "gnd", w: "W", b: "IN", ohms: 10e3, at: 0.25 }] }, ["IN"], ["W"]);
  expect(pot.gain[0][0]).toBeCloseTo(0.25, 6);
  expect(() => gains({ parts: [{ kind: "D", a: "IN", k: "gnd" }] }, ["IN"], [])).toThrow("a D isn't linear");
});
