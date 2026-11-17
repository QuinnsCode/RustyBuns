// The circuit amps (CIRCUITS.md): every board in circuits/ plays like its voicing,
// a part swapped in its socket is one you hear, the solver lands on the
// textbook numbers, no rig blows up on a hot input, the power amp sags and blows
// with nothing on its jack, the mic darkens off the centre, and the Rust port plays
// what the TypeScript solver plays (skipped, with a note, when the wasm isn't built).
import { existsSync, readFileSync } from "node:fs";
import { expect, setDefaultTimeout, test } from "bun:test";
import { B_PLUS, Circuit, PushPull, Rig, cabIR, gainAt, runRig, type Netlist, type RigSpec } from "@rustybuns/gear/circuit";
import { BOARDS, CAP_STEPS, capValue, farads, fuzz, hardClip, overdrive, sockets, toneStack, triodeStage } from "../src/circuit/circuits.ts";
import { AMPS, DEFAULT_ROOM, PEDALS, RIGS, buildRig, tremHz } from "../src/circuit/amps.ts";
import { riff } from "../src/circuit/riff.ts";
import { WasmRig } from "../src/circuit/wasm.ts";
import { instantiateFm } from "../src/engine/wasm.ts";
import { boardToNetlist, readBoard } from "../src/circuit/tscircuit.ts";
import qDist from "../circuits/q-dist.circuit.json";
import qDrive from "../circuits/q-drive.circuit.json";
import qFuzz from "../circuits/q-fuzz.circuit.json";

setDefaultTimeout(60_000);
const SR = 48000;
const sine = (hz: number, seconds: number, amp = 1) => Float32Array.from({ length: SR * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
/** Fails naming `what` and the value when it falls outside lo..hi. */
const inRange = (what: string, v: number, lo: number, hi: number) => expect([what, v >= lo && v <= hi ? "in range" : v]).toEqual([what, "in range"]);
const peak = (b: Float32Array, from = 0) => { let p = 0; for (let i = from; i < b.length; i++) p = Math.max(p, Math.abs(b[i])); return p; };

test("each orderable pedal board (circuits/q-*.tsx) plays like its voicing at every Drive", () => {
  // The 9 V rail and the 4.5 V bias are ground to the signal; jacks, footswitch, LED and supply diode are the box.
  const box = (supply: string, ledR: string) => ({ acGround: ["V9", "VREF"], leaveOut: ["J1", "J2", "J3", "J4", "LED1", ledR, supply] });
  const play = (net: Netlist) => {
    const c = new Circuit(net, SR), rest = c.settle(0);
    return Float32Array.from({ length: SR / 2 }, (_, i) => c.step(0.2 * Math.sin((2 * Math.PI * 220 * i) / SR)) - rest);
  };
  // Each pedal: its board, the box's own parts, and the voicing with the Drive pot (RV1) turned to t.
  for (const [name, board, read, voicing] of [
    // 51k + a 500k pot.
    ["Q Drive", qDrive, box("D3", "R8"), (t: number) => overdrive(t)],
    // 10k + a 200k pot: the sim's one Drive resistor.
    ["Q Dist", qDist, box("D3", "R9"), (t: number) => hardClip(10e3 + t * 200e3)],
    // 20k + a 2M audio pot, whose turn comes out near the square `fuzz()` takes.
    ["Q Fuzz", qFuzz, box("D5", "R9"), (t: number) => fuzz(Math.sqrt(t))],
  ] as const) {
    expect(() => boardToNetlist(board)).toThrow("a chip the simulator doesn't know");
    for (const t of [0, 0.5, 1]) {
      const sim = play(voicing(t)), built = play(boardToNetlist(board, { ...read, knobs: { RV1: t, RV2: 1 } }));
      let diff = 0;
      for (let i = SR / 4; i < sim.length; i++) diff = Math.max(diff, Math.abs(sim[i] - built[i]));
      // What is left is the Level pot and its 1 µF cap loading the tone node.
      inRange(`${name}, Drive pot at ${t}: off the voicing by`, diff / peak(sim, SR / 4), 0, 0.03);
    }
  }
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

/** Peak over RMS after the first 0.1 s: a sine is 1.41, a square 1. */
const crest = (b: Float32Array) => { let ss = 0; const from = SR / 10; for (let i = from; i < b.length; i++) ss += b[i] ** 2; return peak(b, from) / Math.sqrt(ss / (b.length - from)); };
const pedalOut = (net: Netlist, x = sine(220, 0.2, 0.6)) => runRig({ inputVolts: 0.5, links: [{ net }], power: 0, cab: null }, x).out;

test("every board plays like its voicing", () => {
  for (const [what, v, lo, hi] of [
    // x101 on a 0.3 V input would be 30 V; the diodes hold it under a volt.
    ["Q Dist: diodes to ground flatten the tops (peak, V)", peak(pedalOut(hardClip()), SR / 10), 0.3, 1],
    ["Q Drive: the mids get more gain than the lows (dB, 800 Hz over 80 Hz)", gainDb(overdrive(0.5), 800, 192000, 0.001) - gainDb(overdrive(0.5), 80, 192000, 0.001), 6, 20],
    ["Q Fuzz: near square (crest factor)", crest(pedalOut(fuzz(0.7))), 1, 1.2],
    ["the tone stack's Middle knob (dB at 500 Hz, 10 over 0)", gainDb(toneStack({ bass: 5, mid: 10, treble: 5 }), 500) - gainDb(toneStack({ bass: 5, mid: 0, treble: 5 }), 500), 3, 30],
  ] as const) inRange(what, v, lo, hi);
  // Every board reads (the effects need their moving parts named to play: test/effects.test.ts plays them).
  for (const id of Object.keys(BOARDS)) expect([id, readBoard(BOARDS[id as keyof typeof BOARDS]).parts.length > 2]).toEqual([id, true]);
  expect(() => boardToNetlist(BOARDS.vibe)).toThrow("LDR1: a photocell with nothing lighting it");
  expect(() => boardToNetlist(BOARDS.dist, { values: { R9: 1 } })).toThrow("no part R9");
  expect(() => boardToNetlist([{ type: "source_component", source_component_id: "x", ftype: "simple_crystal", name: "X1" }])).toThrow("X1: no model for simple_crystal");
});

test("a part swapped in its socket is one you hear", () => {
  expect(sockets("fuzz").filter((s) => s.kind === "clipper").map((s) => s.parts)).toEqual([["D1", "D2"], ["D3", "D4"]]);
  // Each clipper holds the Q Dist at its own forward drop, lowest to highest.
  const peaks = (["germanium", "silicon", "mosfet", "led", "none"] as const).map((c) => [c, peak(pedalOut(hardClip(100e3, { D1: c })), SR / 10)] as const);
  for (let i = 1; i < peaks.length; i++) expect([peaks[i - 1][0], peaks[i][0], peaks[i][1] > peaks[i - 1][1] * 1.3]).toEqual([peaks[i - 1][0], peaks[i][0], true]);
  // A capacitor socket offers parts you can buy, and a smaller gain-leg cap tightens the lows; a choice the socket doesn't offer leaves it stock.
  inRange("C2 x0.22: dB lost at 60 Hz", gainDb(hardClip(10e3), 60, 192000, 0.001) - gainDb(hardClip(10e3, { C2: "0.22" }), 60, 192000, 0.001), 3, 20);
  expect(CAP_STEPS.map((s) => farads(capValue(47e-9, Number(s))))).toEqual(["10nF", "22nF", "47nF", "100nF", "220nF"]);
  expect(hardClip(10e3, { C2: "0.3", D1: "gold" })).toEqual(hardClip(10e3));
});

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

/** A common-emitter stage: 9 V, a 68k/22k divider, 4.7k collector, 1k emitter. */
const commonEmitter = (o: { pnp?: boolean; ge?: boolean } = {}): Netlist => ({ input: "in", output: "c", parts: [
  { kind: "V", a: o.pnp ? "gnd" : "vcc", b: o.pnp ? "vcc" : "gnd", volts: 9 }, { kind: "C", a: "in", b: "b", farads: 1e-6 },
  { kind: "R", a: "vcc", b: "b", ohms: 68e3 }, { kind: "R", a: "b", b: "gnd", ohms: 22e3 },
  { kind: "R", a: "vcc", b: "c", ohms: 4.7e3 }, { kind: "R", a: "e", b: "gnd", ohms: 1e3 },
  { kind: "BJT", c: "c", b: "b", e: "e", ...o },
] });

/**
 * Every part from ANALOG.md section 1 in one pedal: a transistor stage lighting a vactrol, a
 * self-biased JFET stage, a log pot, an OTA and a wah-ish LC peak the LDR shunts. `flip` is its
 * mirror image: a germanium PNP, a P-channel JFET, a negative supply and a lamp for the LED.
 */
const everyPart = (flip: boolean): Netlist => ({ input: "in", output: "out", parts: [
  ...commonEmitter({ pnp: flip, ge: flip }).parts, { kind: "V", a: "vb", b: "gnd", volts: 9 },
  { kind: "R", a: "c", b: "la", ohms: 1e3 }, { kind: "LDR", a: "out", b: "gnd", la: "la", lk: "gnd", lamp: flip ? 50 : undefined },
  { kind: "C", a: "c", b: "j", farads: 1e-7 }, { kind: "R", a: "j", b: "gnd", ohms: 1e6 },
  { kind: "R", a: "vcc", b: "d", ohms: 4.7e3 }, { kind: "JFET", d: "d", g: "j", s: "s", p: flip }, { kind: "R", a: "s", b: "gnd", ohms: 1e3 },
  { kind: "C", a: "d", b: "p1", farads: 1e-6 }, { kind: "Pot", a: "gnd", w: "pw", b: "p1", ohms: 100e3, at: 0.7, taper: "log" },
  { kind: "OTA", plus: "pw", minus: "gnd", out: "o", abc: "abc" }, { kind: "R", a: "vb", b: "abc", ohms: 47e3 }, { kind: "R", a: "o", b: "gnd", ohms: 10e3 },
  { kind: "R", a: "o", b: "out", ohms: 10e3 }, { kind: "L", a: "out", b: "gnd", henries: 0.5 }, { kind: "C", a: "out", b: "gnd", farads: 1e-8 },
] });

test("transistors, JFETs, inductors, OTAs, LDRs and pots land on the textbook numbers", () => {
  // Small-signal gains. Common emitter: Rc/(Re + re), re = VT/Ie, ×4.6. An LC tank (100 mH, 100 nF) fed
  // through 100k peaks at 1/(2π√LC) = 1.59 kHz, where only the coil's 1 Ω of wire (Q 1000) costs 0.8 dB.
  // An OTA's gm is Iabc/2VT: about 100 µA through 82k into a 10k load is ×19.8.
  const ce = new Circuit(commonEmitter(), 192000);
  ce.settle(0);
  const tank: Netlist = { input: "in", output: "out", parts: [{ kind: "R", a: "in", b: "out", ohms: 100e3 }, { kind: "L", a: "out", b: "gnd", henries: 0.1 }, { kind: "C", a: "out", b: "gnd", farads: 1e-7 }] };
  const f0 = 1 / (2 * Math.PI * Math.sqrt(0.1 * 1e-7));
  const ota: Netlist = { input: "in", output: "out", parts: [{ kind: "V", a: "vb", b: "gnd", volts: 9 }, { kind: "R", a: "vb", b: "abc", ohms: 82e3 }, { kind: "OTA", plus: "in", minus: "gnd", out: "out", abc: "abc" }, { kind: "R", a: "out", b: "gnd", ohms: 10e3 }] };
  const oc = new Circuit(ota, 192000);
  oc.settle(0);
  const gm = (9 - oc.volts("abc")) / 82e3 / (2 * 0.02585);
  const db = (x: number) => 20 * Math.log10(x);
  for (const [what, net, hz, lo, hi, amp] of [
    ["common emitter: Rc/(Re + re)", commonEmitter(), 1000, db(4.7e3 / (1e3 + 0.02585 / (ce.volts("e") / 1e3))) - 0.1, db(4.7e3 / 1e3), 0.01],
    ["the PNP mirror image, the same", commonEmitter({ pnp: true }), 1000, 13.1, 13.4, 0.01],
    ["LC tank at its peak", tank, f0, -0.9, -0.75, 0.01],
    ["LC tank an octave up", tank, 2 * f0, -50, -35, 0.01],
    ["OTA: gm = Iabc/2VT", ota, 1000, db(gm * 10e3) - 0.05, db(gm * 10e3) + 0.05, 0.001],
  ] as const) inRange(what, gainDb(net, hz, 192000, amp), lo, hi);

  // DC: drain or collector current through a 100 Ω sense resistor (or a 1k load), the input as the supply.
  const amps = (net: Netlist, vin: number, node: string, ohms: number) => { const c = new Circuit(net, 48000); c.settle(vin); return (vin - c.volts(node)) / ohms; };
  const jfet = (vgs: number, p = false): Netlist => ({ input: "in", output: "d", parts: [{ kind: "R", a: "in", b: "d", ohms: 100 }, { kind: "V", a: "g", b: "gnd", volts: vgs }, { kind: "JFET", d: "d", g: "g", s: "gnd", p }] });
  // Open base: a transistor passes (β + 1)·ICBO, all leakage. Germanium leaks; silicon doesn't.
  const openBase = (ge: boolean): Netlist => ({ input: "in", output: "c", parts: [{ kind: "R", a: "in", b: "c", ohms: 1e3 }, { kind: "BJT", c: "c", b: "b", e: "gnd", ge }] });
  for (const [what, v, lo, hi] of [
    ["JFET at vgs 0: Idss (3 mA) and a little more for λ", amps(jfet(0), 10, "d", 100), 3.25e-3, 3.33e-3],
    ["JFET at vgs = Vp/2: a quarter of that (square law)", amps(jfet(-1), 10, "d", 100), 0.81e-3, 0.84e-3],
    ["JFET pinched off at Vp", amps(jfet(-2), 10, "d", 100), 0, 1e-9],
    ["JFET near vds 0, vgs = Vp/2: rds = Vp²/(2·Idss·(vgs − Vp)) = 667 Ω", 0.01 / amps(jfet(-1), 0.01, "d", 100) - 100, 660, 673],
    ["P-channel JFET, mirror image", -amps(jfet(0, true), -10, "d", 100), 3.25e-3, 3.33e-3],
    ["germanium, open base: (β + 1)·ICBO = 455 µA", amps(openBase(true), 9, "c", 1e3), 440e-6, 480e-6],
    ["silicon, open base: nothing", amps(openBase(false), 9, "c", 1e3), 0, 1e-9],
  ] as const) inRange(what, v, lo, hi);

  // A vactrol: 10 mA in its LED reads its lit 1k, then the light comes up fast and dies away slowly.
  const vac: Netlist = { input: "in", output: "out", parts: [{ kind: "R", a: "in", b: "la", ohms: 300 }, { kind: "LDR", a: "vs", b: "out", la: "la", lk: "gnd" }, { kind: "V", a: "vs", b: "gnd", volts: 1 }, { kind: "R", a: "out", b: "gnd", ohms: 1e3 }] };
  const lit = new Circuit(vac, 48000), top = lit.settle(5.03);
  inRange("lit: 1k against 1k is half", top, 0.49, 0.51);
  inRange("dark: 1M against 1k is a thousandth", new Circuit(vac, 48000).settle(0), 0.9e-3, 1.1e-3);
  const ldr = new Circuit(vac, 48000);
  ldr.settle(0);
  const until = (vin: number, done: (o: number) => boolean) => { for (let i = 1; i < 48000; i++) if (done(ldr.step(vin))) return i / 48000; return 1; };
  inRange("lights in a few ms", until(5.03, (o) => o > 0.9 * top), 0.002, 0.006);
  inRange("goes dark over a tenth of a second", until(0, (o) => o < 0.1 * top), 0.08, 0.2);
  expect(ldr.misses).toBe(0);

  // Pots: half way round a log pot is 10% of it, reverse log 90%. Turned live, the wiper glides:
  // a volume pot snapped from full to off would jump up to the sine's whole volt in one sample; gliding,
  // no sample moves much more than the 220 Hz sine moves by itself.
  const pot = (at: number, taper: "lin" | "log" | "rlog"): Netlist => ({ input: "in", output: "w", parts: [{ kind: "Pot", a: "gnd", w: "w", b: "in", ohms: 100e3, at, taper }] });
  for (const [taper, want] of [["lin", 0.5], ["log", 0.1], ["rlog", 0.9]] as const) inRange(`${taper} pot half way`, new Circuit(pot(0.5, taper), 48000).settle(1), want - 1e-3, want + 1e-3);
  const vol = new Circuit(pot(1, "log"), 48000);
  vol.settle(0);
  let last = 0, jump = 0;
  for (let i = 0; i < 4800; i++) {
    if (i === 100) vol.setPot(0, 0);
    const o = vol.step(Math.sin((2 * Math.PI * 220 * i) / 48000));
    jump = Math.max(jump, Math.abs(o - last));
    last = o;
  }
  inRange("no click", jump, 0, (1.5 * 2 * Math.PI * 220) / 48000);
  inRange("and off", Math.abs(last), 0, 1e-4);

  // All of them in one pedal, both ways round, on a hot input: converged and finite.
  for (const flip of [false, true]) {
    const run = runRig({ inputVolts: 1, power: 0, cab: null, links: [{ net: everyPart(flip) }] }, sine(220, 0.25));
    expect([flip, run.misses, Number.isFinite(peak(run.out)) && peak(run.out) > 0.01]).toEqual([flip, 0, true]);
  }
});

test("a board with a transistor, a coil, a pot and chips becomes those parts", () => {
  // A tscircuit board's schematic: each component with its pins as [name, net].
  const board = (comps: { name: string; ftype: string; pins: [string, string][]; [k: string]: unknown }[]): unknown[] => [...comps.flatMap(({ pins, ...c }, i) => [
    { type: "source_component", source_component_id: `c${i}`, ...c },
    ...pins.map(([name, net], k) => ({ type: "source_port", source_port_id: `c${i}p${k}`, source_component_id: `c${i}`, name, pin_number: k + 1, subcircuit_connectivity_map_key: net })),
  ]), ...["IN", "OUT", "VCC", "B", "E", "gnd"].map((n) => ({ type: "source_net", name: n, is_ground: n === "gnd", subcircuit_connectivity_map_key: n }))];
  const r = (name: string, a: string, b: string, resistance: number) => ({ name, ftype: "simple_resistor", resistance, pins: [["pin1", a], ["pin2", b]] as [string, string][] });
  const drawn = boardToNetlist(board([
    { name: "C1", ftype: "simple_capacitor", capacitance: 1e-6, pins: [["pin1", "IN"], ["pin2", "B"]] },
    r("R1", "VCC", "B", 68e3), r("R2", "B", "gnd", 22e3), r("R3", "VCC", "OUT", 4.7e3), r("R4", "E", "gnd", 1e3),
    { name: "Q1", ftype: "simple_transistor", transistor_type: "npn", pins: [["emitter", "E"], ["collector", "OUT"], ["base", "B"]] },
  ]), { supplies: { VCC: 9 } });
  inRange("drawn common emitter plays like the hand-written one", gainDb(drawn, 1000) - gainDb(commonEmitter(), 1000), -1e-6, 1e-6);
  const kinds = boardToNetlist(board([
    { name: "L1", ftype: "simple_inductor", inductance: 0.5, pins: [["pin1", "IN"], ["pin2", "OUT"]] },
    { name: "RV1", ftype: "simple_potentiometer", max_resistance: 100e3, pins: [["pin1", "IN"], ["wiper", "OUT"], ["pin3", "gnd"]] },
    { name: "Q2", ftype: "simple_transistor", transistor_type: "pnp", pins: [["emitter", "E"], ["collector", "OUT"], ["base", "B"]] },
    { name: "U1", ftype: "simple_chip", pins: [["DRAIN", "OUT"], ["GATE", "IN"], ["SOURCE", "gnd"]] },
    { name: "U2", ftype: "simple_chip", pins: [["INP", "IN"], ["INN", "gnd"], ["OUT", "OUT"], ["IABC", "B"], ["V+", "VCC"]] },
    { name: "U3", ftype: "simple_chip", pins: [["LEDA", "B"], ["LEDK", "gnd"], ["LDR1", "OUT"], ["LDR2", "gnd"]] },
  ]), { germanium: ["Q2"] }).parts;
  expect(kinds).toEqual([
    { kind: "L", a: "IN", b: "OUT", henries: 0.5 },
    { kind: "Pot", a: "IN", w: "OUT", b: "gnd", ohms: 100e3 },
    { kind: "BJT", c: "OUT", b: "B", e: "E", pnp: true, ge: true },
    { kind: "JFET", d: "OUT", g: "IN", s: "gnd", p: false },
    { kind: "OTA", plus: "IN", minus: "gnd", out: "OUT", abc: "B" },
    { kind: "LDR", a: "OUT", b: "gnd", la: "B", lk: "gnd" },
  ]);
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

test("bias tremolo: a steady note swings at the LFO rate, and the power tubes clip less in the dips", () => {
  // Through the whole amp: Depth 0 holds still, then the knob comes up and the level throbs at Rate's Hz.
  const clean = AMPS.find((a) => a.id === "clean")!;
  const knobs = { ...clean.knobs, noise: 0, rate: 5, depth: 0 };
  const rig = new Rig(buildRig(clean, knobs), SR), note = sine(200, 1, 0.3), out = new Float32Array(note.length);
  const levels = () => { // 10 ms windows: two whole cycles of 200 Hz, so a still note reads still
    const w = SR / 100, ls: number[] = [];
    for (let i = 0; i < note.length; i += w) {
      rig.process(note.subarray(i, i + w), out.subarray(i, i + w), w);
      ls.push(rms(out.subarray(i, i + w)));
    }
    return ls.slice(30); // past the coupling caps settling
  };
  const still = levels();
  inRange("Depth 0: loudest over quietest", Math.max(...still) / Math.min(...still), 1, 1.05);
  rig.setTrem({ hz: tremHz(5), depth: 0.8 });
  const throb = levels(), mean = throb.reduce((s, v) => s + v, 0) / throb.length;
  inRange("Depth 8: loudest over quietest", Math.max(...throb) / Math.min(...throb), 1.5, 3);
  const ups = throb.filter((v, i) => i > 0 && throb[i - 1] < mean && v >= mean).length;
  inRange("throbs in 0.7 s at Rate 5", ups, Math.floor(0.7 * tremHz(5)), Math.ceil(0.7 * tremHz(5)));
  // The power stage alone, driven hot: each 220 Hz cycle's peak, and its crest (peak / rms, a sine's is 1.414, a clipped one's lower).
  const hi = SR * 4, per = hi / 220, pp = new PushPull({ pairs: 1, sag: 250, load: 8, trem: { hz: 4, depth: 1 } }, hi);
  const warm: number[][] = [], cold: number[][] = [];
  let top = 0, sq = 0, k = 0;
  for (let i = 0; i < hi; i++) {
    const y = pp.step(40 * Math.sin((2 * Math.PI * 220 * i) / hi), 1);
    top = Math.max(top, Math.abs(y)); sq += y * y; k++;
    if (k >= per) {
      if (i > hi / 10) (pp.bias > -37 ? warm : pp.bias < -43 ? cold : []).push([top, top / Math.sqrt(sq / k)]);
      top = sq = k = 0;
    }
  }
  const avg = (rows: number[][], j: number) => rows.reduce((s, r) => s + r[j], 0) / rows.length;
  expect(avg(warm, 0)).toBeGreaterThan(avg(cold, 0) * 1.1);
  expect(avg(warm, 1)).toBeLessThan(avg(cold, 1) - 0.05);
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
  const lead = AMPS[1];
  const rigs: Record<string, RigSpec> = {
    ...RIGS,
    "fuzz into lead, hissing": buildRig(lead, { ...lead.knobs, noise: 7 }, { def: PEDALS[1], drive: 6 }),
    "LED dist into lead": buildRig(lead, lead.knobs, { def: PEDALS[2], drive: 6, swaps: { D1: "led", C2: "0.47" } }),
    "brit with nothing on the jack": buildRig(AMPS[0], AMPS[0].knobs, undefined, { ...DEFAULT_ROOM, load: 0 }),
    "every new part": { inputVolts: 1, power: 0, cab: null, links: [{ net: everyPart(false) }] },
    "every new part, mirrored": { inputVolts: 1, power: 0, cab: null, links: [{ net: everyPart(true) }] },
  };
  for (const [name, spec] of Object.entries(rigs)) {
    const ts = new Rig(spec, SR), rust = new WasmRig(x, spec, SR);
    const a = new Float32Array(input.length), b = new Float32Array(input.length);
    ts.process(input, a, half); rust.process(input, b, half);
    // Halfway: every knob Q Amp turns live (a volume, the power drive, the hiss, a rebuilt circuit, a pot inside one, the mic), and a 16 ohm cab.
    const last = spec.links.length - 1;
    for (const r of [ts, rust]) {
      r.setGain(last, 0.5); r.setPower(spec.power ? 3 : 0); r.setNoise(2); r.setLink(0, spec.links[0].net); r.setPot(0, 0, 0.2);
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
