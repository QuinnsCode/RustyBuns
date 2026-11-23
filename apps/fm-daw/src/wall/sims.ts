// The sound wall's modules as sound, each from its own board (circuits/wall-*.tsx, WALL.md). Three ways, by what the
// circuit is:
//   - What only bends a little and has memory (the envelope, the VCA, the filter) runs its board's netlist in the
//     circuit solver every sample, as Q Amp's pedals do. Where the board sets a chip's bias current with transistors
//     (an exponential converter, a current sink and mirror), that current is worked out from the board's parts and
//     handed to the chip's bias pin as a current source, rather than solving the transistors each sample.
//   - What is linear and has no memory (the mixer, the output) mixes with its board's own gains (linear.ts), worked
//     out again whenever a knob moves.
//   - What switches (the oscillators, the LFO, the sequencer's clock and counter) runs from the numbers its parts set:
//     the reference current, the integrating capacitor and the comparator's threshold for the VCO, the 555's
//     resistors and capacitor for the clock, the Schmitt trigger's divider for the LFO. Change a part on the board and
//     the sound follows.
// Volts in and volts out, Eurorack's levels: audio +-5 V, 1 V an octave, gates 0 to 10 V.
import { Circuit, fixPots, potShare, type Netlist, type Part } from "@rustybuns/gear/circuit";
import { netlistOf, readBoard, type Board, type BoardOptions, type BoardPart } from "../circuit/tscircuit.ts";
import { panel } from "../../circuits/wall-panels.ts";
import { gains, type Gains } from "./linear.ts";
import seqBoard from "../../circuits/wall-seq.circuit.json";
import vcoBoard from "../../circuits/wall-vco.circuit.json";
import vcfBoard from "../../circuits/wall-vcf.circuit.json";
import vcaBoard from "../../circuits/wall-vca.circuit.json";
import envBoard from "../../circuits/wall-env.circuit.json";
import lfoBoard from "../../circuits/wall-lfo.circuit.json";
import mixBoard from "../../circuits/wall-mix.circuit.json";
import outBoard from "../../circuits/wall-out.circuit.json";

/** Each module's board as circuit JSON, by kind: read through `readBoard`, which checks it. */
const BOARDS = new Map<string, unknown>([["seq", seqBoard], ["vco", vcoBoard], ["vcf", vcfBoard], ["vca", vcaBoard], ["env", envBoard], ["lfo", lfoBoard], ["mix", mixBoard], ["out", outBoard]]);
/** Every module kind the wall has. */
export const KINDS = [...BOARDS.keys()];

/** A TL07x's output swing on +-12 V, and the supplies. */
export const RAIL = 11;
const SUPPLIES = { V12: 12, VN12: -12 };
/** The thermal voltage at the room's 26 C, where the VCO's scale is trimmed: kT/q. */
const VT = (1.380649e-23 * 299.15) / 1.602176634e-19;
/** How long the VCO's reset takes (the comparator's slew and the JFET emptying C2): what flattens its top octaves. */
const RESET_S = 2e-6;
/** A Schottky's drop at the sequencer bus's few microamps, and a 555's high output on 12 V. */
const SCHOTTKY = 0.15, GATE_HIGH = 10.5;
/** A B5819W Schottky's junction (about 0.25 V at 10 mA), where a board has one and the solver models its diode. */
const SCHOTTKY_JUNCTION = { is: 1e-6, n: 1.05 };

/** One module at work: volts at its inputs in, volts at its outputs out, a sample at a time. Jacks in panel order. */
export interface Sim {
  readonly ins: string[];
  readonly outs: string[];
  step(x: Float64Array, y: Float64Array): void;
  /** Its knobs, 0 to 1 by name (a knob left out stays where it is). */
  knobs(k: Record<string, number>): void;
  /** What it is doing, for probes and tests. */
  read(): Record<string, number>;
}

/** A module's board, read with what isn't its circuit left out: its jacks, the power header and every chip's decoupling. */
function board(id: string): Board {
  const p = panel(id);
  const decouple = ["U1", "U2", "U3", "U4"].flatMap((u) => [`C${u}P`, `C${u}N`]);
  const chips = id === "seq" ? ["U1", "U2"] : []; // the 555 and the 4017 aren't parts the solver models; their numbers are read off
  return readBoard(BOARDS.get(id), { leaveOut: [...p.jacks.map((j) => j.part), "JP1", "DP1", "DP2", "CP1", "CP2", ...decouple, ...chips] });
}

const part = (b: Board, name: string): BoardPart => {
  const p = b.parts.find((x) => x.name === name);
  if (!p) throw new Error(`no ${name} on this board`);
  return p;
};
/** A resistor's or pot's ohms, a capacitor's farads. */
function value(b: Board, name: string): number {
  const p = part(b, name);
  if (p.kind === "R" || p.kind === "Pot") return p.ohms;
  if (p.kind === "C") return p.farads;
  throw new Error(`${name} is a ${p.kind}, with no one value`);
}

/** The board's pots set: each panel knob at its turn (and taper), any other pot (a trimmer) at `trims`. */
function turned(id: string, b: Board, knobs: Record<string, number>, trims: Record<string, number> = {}): Board {
  const p = panel(id);
  return {
    ...b,
    parts: b.parts.map((x): BoardPart => {
      if (x.kind !== "Pot") return x;
      const k = p.knobs.find((y) => y.part === x.name);
      if (k) return { ...x, at: knobs[k.name] ?? k.dflt, taper: k.taper };
      return x.name in trims ? { ...x, at: trims[x.name] } : x;
    }),
  };
}
/** Some of a board's parts (by name) as a netlist, with the supplies on. */
function netOf(b: Board, names: string[] | null, o: BoardOptions = {}): Netlist {
  const keep = names ? b.parts.filter((p) => names.includes(p.name)) : b.parts;
  if (names) for (const n of names) if (!keep.some((p) => p.name === n)) throw new Error(`no ${n} on this board`);
  return netlistOf({ ...b, parts: keep }, { supplies: SUPPLIES, rail: RAIL, ...o });
}
/** A pot as a variable resistor (one leg on its wiper): the ohms between its two ends now. */
function rheostat(b: Board, name: string): number {
  const p = part(b, name);
  if (p.kind !== "Pot") throw new Error(`${name} isn't a pot`);
  const share = potShare(p);
  return p.a === p.w ? p.ohms * (1 - share) : p.ohms * share;
}
const knobsOf = (id: string) => Object.fromEntries(panel(id).knobs.map((k) => [k.name, k.dflt]));
/** `y = gain · x + offset` for one output of one input. */
const line = (g: Gains, o = 0, i = 0) => (x: number) => g.gain[o][i] * x + g.offset[o];

/** PolyBLEP: the correction that takes the corner off a jump at phase 0, so a saw or pulse doesn't alias. */
function blep(t: number, dt: number): number {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

/** Q Saw: the sawtooth core's frequency from its exponential converter, reference current, C2 and threshold. */
class Vco implements Sim {
  readonly ins = ["voct", "fm"];
  readonly outs = ["saw", "pulse"];
  private readonly b = board("vco");
  private readonly iref: number;
  private readonly vth: number;
  private readonly cint: number;
  private readonly pulseV: number;
  private readonly trim: number;
  private base = (_v: number, _fm: number) => 0;
  private saw = (_ramp: number) => 0;
  private width = 0.5;
  private phase = 0;
  private hz = 0;
  constructor(private readonly sampleRate: number, k: Record<string, number>) {
    const b = this.b, r = (n: string) => value(b, n);
    this.iref = SUPPLIES.V12 / r("R8");
    this.vth = (SUPPLIES.V12 * r("R11")) / (r("R10") + r("R11"));
    this.cint = r("C2");
    this.pulseV = (RAIL * r("R22")) / (r("R21") + r("R22"));
    // RT1 trimmed as a builder trims it: until a volt is an octave, here at 26 C.
    const k1 = VT * Math.LN2, lo = r("R7"), hi = r("R6");
    this.trim = Math.min(1, Math.max(0, (k1 * (hi + lo) - lo) / (r("RT1") * (1 - k1))));
    this.knobs(k);
  }
  knobs(k: Record<string, number>) {
    const b = turned("vco", this.b, { ...knobsOf("vco"), ...k }, { RT1: this.trim });
    const ctl = gains(netOf(b, ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "RT1", "RV1", "RV2", "RV3", "U1A"]), ["VOCT", "FM"], ["B1"]);
    this.base = (v, fm) => ctl.gain[0][0] * v + ctl.gain[0][1] * fm + ctl.offset[0];
    this.saw = line(gains(netOf(b, ["R15", "R16", "R17", "U2A"]), ["RAMP"], ["SAW_I"]));
    const pw = gains(netOf(b, ["R19", "R20", "RV4"]), [], ["PW_W"]).offset[0];
    this.width = Math.min(0.98, Math.max(0.02, pw / this.vth));
  }
  step(x: Float64Array, y: Float64Array) {
    // The converter: Q2 sinks Iref e^(-Vb1/VT), doubled for each volt on V/Oct; C2 fills to the threshold, then resets.
    const i = this.iref * Math.exp(-this.base(x[0], x[1]) / VT);
    const f = Math.min(1 / (this.cint * this.vth / i + RESET_S), this.sampleRate * 0.45);
    this.hz = f;
    const dt = f / this.sampleRate;
    this.phase += dt;
    if (this.phase >= 1) this.phase -= Math.floor(this.phase);
    const t = this.phase, top = this.saw(this.vth), bottom = this.saw(0);
    y[0] = this.saw(t * this.vth) + ((bottom - top) / 2) * blep(t, dt);
    const d = this.width, p = this.pulseV;
    let pulse = t > d ? p : -p;
    pulse -= p * blep(t, dt);
    pulse += p * blep((t - d + 1) % 1, dt);
    y[1] = pulse;
  }
  read() { return { hz: this.hz }; }
}

/** Q Wobble: the Schmitt trigger and integrator's rate and levels from R1, Rate, C1 and the divider R2/R3. */
class Lfo implements Sim {
  readonly ins: string[] = [];
  readonly outs = ["tri", "sqr"];
  private readonly b = board("lfo");
  private hz = 1;
  private phase = 0;
  private readonly tri: number;
  private readonly sqr: number;
  constructor(private readonly sampleRate: number, k: Record<string, number>) {
    const r = (n: string) => value(this.b, n);
    this.tri = (RAIL * r("R2")) / r("R3");
    this.sqr = (RAIL * r("R6")) / (r("R5") + r("R6"));
    this.knobs(k);
  }
  knobs(k: Record<string, number>) {
    const b = turned("lfo", this.b, { ...knobsOf("lfo"), ...k }), r = (n: string) => value(b, n);
    this.hz = r("R3") / (4 * r("R2") * (r("R1") + rheostat(b, "RV1")) * r("C1"));
  }
  step(_x: Float64Array, y: Float64Array) {
    this.phase = (this.phase + this.hz / this.sampleRate) % 1;
    const t = this.phase;
    // The square high, the triangle falls; low, it rises.
    y[0] = t < 0.5 ? this.tri * (1 - 4 * t) : this.tri * (4 * t - 3);
    y[1] = t < 0.5 ? this.sqr : -this.sqr;
  }
  read() { return { hz: this.hz }; }
}

/** Q Steps: the 555's rate and duty from R1, R2, Rate and C1; each step's CV from its pot, the Schottky and R4/R5. */
class Seq implements Sim {
  readonly ins: string[] = [];
  readonly outs = ["gate", "cv"];
  private readonly b = board("seq");
  private hz = 1;
  private duty = 0.5;
  private phase = 0;
  private at = 0;
  private cvs: number[] = [];
  constructor(private readonly sampleRate: number, k: Record<string, number>) { this.knobs(k); }
  knobs(k: Record<string, number>) {
    const b = turned("seq", this.b, { ...knobsOf("seq"), ...k }), r = (n: string) => value(b, n);
    const rb = r("R2") + rheostat(b, "RV9"), ra = r("R1");
    this.hz = 1.44 / ((ra + 2 * rb) * r("C1"));
    this.duty = (ra + rb) / (ra + 2 * rb);
    const down = r("R5") / (r("R4") + r("R5"));
    this.cvs = Array.from({ length: 8 }, (_, i) => {
      const p = part(b, `RV${i + 1}`);
      return p.kind === "Pot" ? Math.max(0, potShare(p) * SUPPLIES.V12 - SCHOTTKY) * down : 0;
    });
  }
  step(_x: Float64Array, y: Float64Array) {
    this.phase += this.hz / this.sampleRate;
    if (this.phase >= 1) { this.phase -= 1; this.at = (this.at + 1) % 8; }
    y[0] = this.phase < this.duty ? GATE_HIGH : 0;
    y[1] = this.cvs[this.at];
  }
  read() { return { hz: this.hz, step: this.at + 1, cv: this.cvs[this.at] }; }
}

/** A module whose board runs in the solver: built again (carrying its state on) when a knob on its signal path moves. */
abstract class Solved implements Sim {
  abstract readonly ins: string[];
  abstract readonly outs: string[];
  protected circuit: Circuit | null = null;
  protected turns: Record<string, number>;
  protected readonly b: Board;
  protected constructor(protected readonly id: string, protected readonly sampleRate: number, k: Record<string, number>) {
    this.turns = { ...knobsOf(id), ...k };
    this.b = board(id);
  }
  /** The netlist the solver runs, at these turns. */
  protected abstract audio(b: Board): Netlist;
  /** The control side, at these turns. */
  protected control(_b: Board) {}
  protected build() {
    const b = turned(this.id, this.b, this.turns);
    this.control(b);
    const next = new Circuit(fixPots(this.audio(b)), this.sampleRate);
    if (!this.circuit || !next.adopt(this.circuit)) next.settle(0);
    this.circuit = next;
    this.wired(next);
  }
  /** The new circuit's slots (its current sources). */
  protected wired(_c: Circuit) {}
  knobs(k: Record<string, number>) {
    if (Object.entries(k).every(([n, v]) => this.turns[n] === v) && this.circuit) return;
    this.turns = { ...this.turns, ...k };
    this.build();
  }
  abstract step(x: Float64Array, y: Float64Array): void;
  read(): Record<string, number> { return { misses: this.circuit?.misses ?? 0 }; }
}

/** Q Swell: the whole board in the solver, gate in, envelope out. */
class Env extends Solved {
  readonly ins = ["gate"];
  readonly outs = ["out"];
  constructor(sampleRate: number, k: Record<string, number>) { super("env", sampleRate, k); this.build(); }
  protected audio(b: Board) { return netOf(b, null, { input: "GATE", output: "OUT", linear: ["U1B"], diodes: { D3: SCHOTTKY_JUNCTION } }); }
  step(x: Float64Array, y: Float64Array) { y[0] = this.circuit?.step(x[0]) ?? 0; }
}

/** The bias current source on an OTA's pin: an "I" part from ground into it. */
const bias = (net: Netlist, ...pins: string[]): Netlist => ({ ...net, parts: [...net.parts, ...pins.map((b): Part => ({ kind: "I", a: "gnd", b, amps: 0 }))] });

/** Q Level: the OTA and U1D in the solver; Level and CV through U1A/U1B to P_CTL, sunk as P_CTL / R10 into the bias pin. */
class Vca extends Solved {
  readonly ins = ["in", "cv"];
  readonly outs = ["out"];
  private ctl = (_cv: number) => 0;
  private slot = 0;
  private amps = 0;
  constructor(sampleRate: number, k: Record<string, number>) { super("vca", sampleRate, k); this.build(); }
  protected control(b: Board) {
    const g = gains(netOf(b, ["R1", "R2", "R3", "R4", "R5", "R6", "RV1", "RV2", "U1A", "U1B"]), ["CV"], ["P_CTL"]), re = value(b, "R10");
    this.ctl = (cv) => Math.max(0, g.gain[0][0] * cv + g.offset[0]) / re;
  }
  protected audio(b: Board) { return bias(netOf(b, ["U2A", "R13", "R14", "R15", "U1D", "R16", "C1", "R17"]), "IABC"); }
  protected wired(c: Circuit) { this.slot = c.sourceInto("IABC"); }
  knobs(k: Record<string, number>) {
    // Its knobs are all on the control side: no rebuild.
    this.turns = { ...this.turns, ...k };
    this.control(turned("vca", this.b, this.turns));
  }
  step(x: Float64Array, y: Float64Array) {
    const c = this.circuit;
    if (!c) { y[0] = 0; return; }
    this.amps = this.ctl(x[1]);
    c.push(this.slot, this.amps);
    y[0] = c.step(x[0]);
  }
  read() { return { ...super.read(), bias: this.amps }; }
}

/** Q Filter: the state-variable loop in the solver; Freq and CV through the exponential converter into both bias pins. */
class Vcf extends Solved {
  readonly ins = ["in", "cv"];
  readonly outs = ["lp", "bp", "hp"];
  private base = (_cv: number) => 0;
  private iref = 0;
  private most = 0;
  private slots: [number, number] = [0, 0];
  private amps = 0;
  constructor(sampleRate: number, k: Record<string, number>) { super("vcf", sampleRate, k); this.build(); }
  protected control(b: Board) {
    this.base = line(gains(netOf(b, ["R1", "R2", "R3", "R4", "R5", "RV1", "RV3", "U1A"]), ["CV"], ["B2"]));
    this.iref = -SUPPLIES.VN12 / value(b, "R6");
    // U1B can lift the emitters only so far: R7 shares that between the reference and the two outputs.
    this.most = Math.max(0, ((RAIL - 0.7) / value(b, "R7") - this.iref) / 2);
  }
  protected audio(b: Board) {
    const parts = ["R8", "R9", "R10", "RV2", "R11", "U1C", "R12", "R13", "R14", "U2A", "C3", "U1D", "R15", "R16", "R17", "U2B", "C4", "U3A", "R18", "R19", "R20"];
    return bias(netOf(b, parts, { input: "IN", output: "LP", linear: ["U1D", "U3A"] }), "IABC_A", "IABC_B");
  }
  protected wired(c: Circuit) { this.slots = [c.sourceInto("IABC_A"), c.sourceInto("IABC_B")]; }
  knobs(k: Record<string, number>) {
    // Freq and CV are the converter's: no rebuild. Res is on the loop.
    const res = k.res !== undefined && k.res !== this.turns.res;
    this.turns = { ...this.turns, ...k };
    if (res || !this.circuit) this.build(); else this.control(turned("vcf", this.b, this.turns));
  }
  step(x: Float64Array, y: Float64Array) {
    const c = this.circuit;
    if (!c) { y[0] = y[1] = y[2] = 0; return; }
    // PNPs: Iref e^(-Vb2/VT) each, a volt an octave, up to what R7 lets through.
    this.amps = Math.min(this.iref * Math.exp(-this.base(x[1]) / VT), this.most);
    c.push(this.slots[0], this.amps);
    c.push(this.slots[1], this.amps);
    y[0] = c.step(x[0]);
    y[1] = c.volts("BP");
    y[2] = c.volts("HP");
  }
  read() {
    // A two-pole state-variable cutoff: gm k / C, gm = Iabc / 2VT, k the 100k into 220R.
    const k = 220 / (100e3 + 220), hz = ((this.amps / (2 * VT)) * k) / (2 * Math.PI * 1e-9);
    return { ...super.read(), bias: this.amps, hz };
  }
}

/** A module that mixes with its board's own gains, clipped at the op-amps' rails. */
class Linear implements Sim {
  readonly ins: string[];
  readonly outs: string[];
  private g: Gains;
  private turns: Record<string, number>;
  private readonly b: Board;
  constructor(private readonly id: string, k: Record<string, number>) {
    const p = panel(id);
    this.ins = p.jacks.filter((j) => j.dir === "in").map((j) => j.name);
    this.outs = p.jacks.filter((j) => j.dir === "out").map((j) => j.name);
    this.b = board(id);
    this.turns = { ...knobsOf(id), ...k };
    this.g = this.solve();
  }
  private solve(): Gains {
    const net = netOf(turned(this.id, this.b, this.turns), null);
    const name = (j: string) => j.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    return gains(net, this.ins.map(name), this.outs.map(name));
  }
  knobs(k: Record<string, number>) {
    if (Object.entries(k).every(([n, v]) => this.turns[n] === v)) return;
    this.turns = { ...this.turns, ...k };
    this.g = this.solve();
  }
  step(x: Float64Array, y: Float64Array) {
    const { gain, offset } = this.g;
    for (let o = 0; o < gain.length; o++) {
      let v = offset[o];
      const row = gain[o];
      for (let i = 0; i < row.length; i++) v += row[i] * x[i];
      y[o] = v > RAIL ? RAIL : v < -RAIL ? -RAIL : v;
    }
  }
  read() { return {}; }
  /** The board's gain from input `from` to output `to` now (for tests and the room's labels). */
  gain(from: string, to: string): number { return this.g.gain[this.outs.indexOf(to)]?.[this.ins.indexOf(from)] ?? 0; }
}

/** A module of `kind` at these knobs. */
export function makeSim(kind: string, sampleRate: number, knobs: Record<string, number> = {}): Sim {
  switch (kind) {
    case "vco": return new Vco(sampleRate, knobs);
    case "lfo": return new Lfo(sampleRate, knobs);
    case "seq": return new Seq(sampleRate, knobs);
    case "env": return new Env(sampleRate, knobs);
    case "vca": return new Vca(sampleRate, knobs);
    case "vcf": return new Vcf(sampleRate, knobs);
    case "mix": case "out": return new Linear(kind, knobs);
  }
  throw new Error(`no sound wall module ${kind}`);
}
export { Linear };
