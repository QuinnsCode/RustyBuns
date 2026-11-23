// The sound wall's modules as sound, each from its own board (circuits/wall-*.tsx, WALL.md). Three ways, by what the
// circuit is:
//   - What only bends a little and has memory (the envelope, the VCA, the filter) runs its board's netlist in the
//     circuit solver every sample, as Q Amp's pedals do. Where the board sets a chip's bias current with transistors
//     (an exponential converter, a current sink and mirror), that current is worked out from the board's parts and
//     handed to the chip's bias pin as a current source, rather than solving the transistors each sample.
//   - What is linear and has no memory (the mixer, the output) mixes with its board's own gains (`gains` in
//     @rustybuns/gear/circuit), worked out again whenever a knob moves.
//   - What switches (the oscillators, the LFO, the sequencer's clock and counter, the sample and hold) runs from the numbers its parts set:
//     the reference current, the integrating capacitor and the comparator's threshold for the VCO, the 555's
//     resistors and capacitor for the clock, the Schmitt trigger's divider for the LFO. Change a part on the board and
//     the sound follows. Q Keys' microcontroller is its firmware's logic (notes, the MIDI clock) into the board's gains.
// Volts in and volts out, Eurorack's levels: audio +-5 V, 1 V an octave, gates 0 to 10 V.
import { clamp, mulberry32 } from "@rustybuns/util";
import { Biquad, Brigade, Circuit, fixPots, gains, potShare, type Gains, type Netlist, type Part } from "@rustybuns/gear/circuit";
import { netlistOf, readBoard, type Board, type BoardOptions, type BoardPart } from "../circuit/tscircuit.ts";
import { panel } from "../../circuits/wall-panels.ts";
import seqBoard from "../../circuits/wall-seq.circuit.json";
import keysBoard from "../../circuits/wall-keys.circuit.json";
import vcoBoard from "../../circuits/wall-vco.circuit.json";
import vcfBoard from "../../circuits/wall-vcf.circuit.json";
import vcaBoard from "../../circuits/wall-vca.circuit.json";
import envBoard from "../../circuits/wall-env.circuit.json";
import lfoBoard from "../../circuits/wall-lfo.circuit.json";
import mixBoard from "../../circuits/wall-mix.circuit.json";
import outBoard from "../../circuits/wall-out.circuit.json";
import noiseBoard from "../../circuits/wall-noise.circuit.json";
import bbdBoard from "../../circuits/wall-bbd.circuit.json";

/** Each module's board as circuit JSON, by kind: read through `readBoard`, which checks it. */
const BOARDS = new Map<string, unknown>([["seq", seqBoard], ["vco", vcoBoard], ["vcf", vcfBoard], ["vca", vcaBoard], ["env", envBoard], ["lfo", lfoBoard], ["mix", mixBoard], ["out", outBoard], ["noise", noiseBoard], ["keys", keysBoard], ["bbd", bbdBoard]]);
/** Every module kind the wall has. */
export const KINDS = [...BOARDS.keys()];

/** A TL07x's output swing on +-12 V, and the supplies. */
export const RAIL = 11;
const SUPPLIES = { V12: 12, VN12: -12 };
/** Q Keys' MCP4822: 12 bits at 1 mV a step (its 2.048 V reference, gain 2), and the MIDI clock's 24 ticks a beat. */
const DAC_STEP = 1e-3, DAC_TOP = 4095, PPQN = 24;
/** The key at 0 V on Q Keys' pitch out (C2), and the note lengths its Div knob picks, in MIDI clock ticks. */
const KEYS_BASE = 36, DIVS = [24, 12, 6];
/** The thermal voltage at the room's 26 C, where the VCO's scale is trimmed: kT/q. */
const VT = (1.380649e-23 * 299.15) / 1.602176634e-19;
/** How long the VCO's reset takes (the comparator's slew and the JFET emptying C2): what flattens its top octaves. */
const RESET_S = 2e-6;
/** A 1N4148's drop, where one clamps a node. */
const DIODE = 0.6;
/** A TL07x's gain-bandwidth, Hz: what rolls off the top of a high-gain stage. */
const GBW = 3e6;
/**
 * The hiss of a small NPN's base-emitter junction in breakdown at about 10 uA, volts rms over the audio band. It
 * varies several times from one transistor to the next (and with the current), so a built Q Hiss can be louder or
 * quieter than this; it is what makes the sim's noise come out at a few volts, as the board means it to.
 */
const JUNCTION_RMS = 0.02;
/** A Schottky's drop at the sequencer bus's few microamps, and a 555's high output on 12 V. */
const SCHOTTKY = 0.15, GATE_HIGH = 10.5;
/** A B5819W Schottky's junction (about 0.25 V at 10 mA), where a board has one and the solver models its diode. */
const SCHOTTKY_JUNCTION = { is: 1e-6, n: 1.05 };
/** A small silicon transistor's base-emitter drop, where a clock input's threshold hangs on one. */
const VBE = 0.65;

/** One module at work: volts at its inputs in, volts at its outputs out, a sample at a time. Jacks in panel order. */
export interface Sim {
  readonly ins: string[];
  readonly outs: string[];
  /** A key down (velocity 0 to 1) or up (0): the room's keys and MIDI, for a module that takes them. */
  note?(midi: number, vel: number): void;
  /** The sesh's tempo, and the beat it is on now when the band's clock is known. */
  tempo?(bpm: number, beat: number | null): void;
  step(x: Float64Array, y: Float64Array): void;
  /** Its knobs, 0 to 1 by name (a knob left out stays where it is). */
  knobs(k: Record<string, number>): void;
  /** What it is doing, for probes and tests. */
  read(): Record<string, number>;
  /** Which of its inputs have a cable in, when the board tells them apart (an `inside` jack's switch). */
  plugged?(ins: boolean[]): void;
}

/** A module's board, read with what isn't its circuit left out: its jacks, the power header and every chip's decoupling. */
function board(id: string): Board {
  const p = panel(id);
  const decouple = ["U1", "U2", "U3", "U4"].flatMap((u) => [`C${u}P`, `C${u}N`]);
  // The 555 and the 4017, and Q Keys' digital side, aren't parts the solver models; their numbers are read off.
  // Q Brigade's compander, bucket brigade, regulator and clock chips are read off their datasheets the same way.
  const chips = id === "seq" ? ["U1", "U2"] : id === "keys" ? ["U1", "U2", "U3", "U4", "JP2", "JP3"] : id === "bbd" ? ["U2", "U3", "U5", "U6", "U7", "U8"] : [];
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

/** A one-pole low-pass's coefficient for time constant `tau` seconds at this rate. */
const pole = (tau: number, sampleRate: number) => 1 - Math.exp(-1 / (tau * sampleRate));

/**
 * Q Hiss: the junction's hiss (JUNCTION_RMS, white) through C1 into R2, then U1A's gain (one at DC, 1 + R4/R3 above
 * R3 and C2's corner) rolled off where the gain meets the op-amp's bandwidth. The sample and hold tracks its input
 * while the clock's edge, high-passed by C4 and R8 (D3 holding it above -0.6 V), stays over R9/R10's share of 12 V,
 * and holds it after. S&H In is the noise while nothing is plugged in.
 */
class Noise implements Sim {
  readonly ins = ["in", "clock"];
  readonly outs = ["noise", "out"];
  private readonly b = board("noise");
  private readonly rand = mulberry32(0x5eed);
  private readonly ac: number;
  private readonly shelf: number;
  private readonly gain: number;
  private readonly top: number;
  private readonly edge: number;
  private readonly ref: number;
  private own = true;
  private dc = 0;
  private lowAc = 0;
  private lowTop = 0;
  private trig = 0;
  private lastClock = 0;
  private held = 0;
  private tracking = false;
  constructor(private readonly sampleRate: number, _k: Record<string, number>) {
    const r = (n: string) => value(this.b, n);
    this.ac = pole(r("R2") * r("C1"), sampleRate);
    this.shelf = pole(r("R3") * r("C2"), sampleRate);
    this.gain = r("R4") / r("R3");
    this.top = pole((1 + this.gain) / (2 * Math.PI * GBW), sampleRate);
    this.edge = Math.exp(-1 / (r("R8") * r("C4") * sampleRate));
    this.ref = (SUPPLIES.V12 * r("R10")) / (r("R9") + r("R10"));
  }
  knobs(_k: Record<string, number>) {}
  plugged(ins: boolean[]) { this.own = !ins[0]; }
  /** White noise, JUNCTION_RMS rms (Box-Muller). */
  private hiss(): number {
    const u = 1 - this.rand(), v = this.rand();
    return JUNCTION_RMS * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  step(x: Float64Array, y: Float64Array) {
    // C1 into R2 takes off the junction's DC; U1A gains its highs by 1 + R4/R3.
    const j = this.hiss();
    this.dc += this.ac * (j - this.dc);
    const a = j - this.dc;
    this.lowAc += this.shelf * (a - this.lowAc);
    const amp = a + this.gain * (a - this.lowAc);
    this.lowTop += this.top * (amp - this.lowTop);
    const noise = this.lowTop > RAIL ? RAIL : this.lowTop < -RAIL ? -RAIL : this.lowTop;
    y[0] = noise;
    // The clock's edge, high-passed and clamped, against the threshold.
    const c = x[1];
    this.trig = Math.max(-DIODE, this.edge * (this.trig + c - this.lastClock));
    this.lastClock = c;
    this.tracking = this.trig > this.ref;
    if (this.tracking) this.held = this.own ? noise : x[0];
    y[1] = this.held > RAIL ? RAIL : this.held < -RAIL ? -RAIL : this.held;
  }
  read() { return { held: this.held, tracking: this.tracking ? 1 : 0, threshold: this.ref }; }
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

/**
 * Q Steps: the 555's rate and duty from R1, R2, Rate and C1; each step's CV from its pot, the Schottky and R4/R5. With
 * a cable in Clock In, a step on each rise past Q1's threshold (its Vbe over R9's share of R8 and R9), and the gate out
 * is that clock. In a sesh (`tempo` with the band's beat) its own clock follows the shared beat, so every page plays
 * the same step on the same beat: the 555's rate rounds to the nearest power of two steps a beat (an eighth to 16), and
 * the count is the beat's.
 */
class Seq implements Sim {
  readonly ins = ["clock"];
  readonly outs = ["gate", "cv"];
  private readonly b = board("seq");
  private hz = 1;
  private duty = 0.5;
  private phase = 0;
  private at = 0;
  private cvs: number[] = [];
  private external = false;
  private high = false;
  /** The sesh's tempo while it follows the band's beat, else 0 (its own 555); the beat it is on, and its steps a beat. */
  private bpm = 0;
  private beat = 0;
  private perBeat = 1;
  private readonly threshold: number;
  constructor(private readonly sampleRate: number, k: Record<string, number>) {
    const r = (n: string) => value(this.b, n);
    this.threshold = (VBE * (r("R8") + r("R9"))) / r("R9");
    this.knobs(k);
  }
  plugged(ins: boolean[]) { this.external = ins[0]; }
  knobs(k: Record<string, number>) {
    const b = turned("seq", this.b, { ...knobsOf("seq"), ...k }), r = (n: string) => value(b, n);
    const rb = r("R2") + rheostat(b, "RV9"), ra = r("R1");
    this.hz = 1.44 / ((ra + 2 * rb) * r("C1"));
    this.duty = (ra + rb) / (ra + 2 * rb);
    this.divide();
    const down = r("R5") / (r("R4") + r("R5"));
    this.cvs = Array.from({ length: 8 }, (_, i) => {
      const p = part(b, `RV${i + 1}`);
      return p.kind === "Pot" ? Math.max(0, potShare(p) * SUPPLIES.V12 - SCHOTTKY) * down : 0;
    });
  }
  step(x: Float64Array, y: Float64Array) {
    if (this.external) {
      // Q1 has some hysteresis in practice; a tenth of a volt keeps a slow edge from counting twice.
      const v = x[0], high = this.high ? v > this.threshold - 0.1 : v > this.threshold;
      if (high && !this.high) this.at = (this.at + 1) % 8;
      this.high = high;
      y[0] = v;
    } else {
      if (this.bpm) {
        this.beat += this.bpm / 60 / this.sampleRate;
        const t = this.beat * this.perBeat, w = Math.floor(t);
        this.at = ((w % 8) + 8) % 8; this.phase = t - w;
      } else {
        this.phase += this.hz / this.sampleRate;
        if (this.phase >= 1) { this.phase -= 1; this.at = (this.at + 1) % 8; }
      }
      y[0] = this.phase < this.duty ? GATE_HIGH : 0;
    }
    y[1] = this.cvs[this.at];
  }
  /** Steps a beat: the 555's rate to the nearest power of two of the sesh's beats, an eighth to 16. */
  private divide() { if (this.bpm) this.perBeat = 2 ** clamp(Math.round(Math.log2((this.hz * 60) / this.bpm)), -3, 4); }
  tempo(bpm: number, beat: number | null) {
    if (beat === null || !(bpm > 0)) { this.bpm = 0; return; }
    this.bpm = bpm;
    this.divide();
    // onto the band's beat only when it is off by more than a fiftieth of one, so a message's jitter never moves a gate
    if (Math.abs(beat - this.beat) > 0.02) this.beat = beat;
  }
  read() { return { hz: this.external ? 0 : this.bpm ? (this.perBeat * this.bpm) / 60 : this.hz, step: this.at + 1, cv: this.cvs[this.at], threshold: this.threshold }; }
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

/**
 * Q Keys: its firmware's logic into its board. The last key held is the pitch, a volt an octave from C2, written to the
 * DAC as a firmware for a gain of two would (1 mV steps, 12 bits); the gate is high while any key is; the velocity is
 * the DAC's other half. The clock counts the MIDI clock (the sesh's tempo, 24 ticks a beat) down to the Div knob's
 * quarter, eighth or sixteenth, high for the first half of each. U5's four gains come from the board, RT1 trimmed as a
 * builder trims it, until a key an octave up is a volt up.
 */
class Keys implements Sim {
  readonly ins: string[] = [];
  readonly outs = ["pitch", "gate", "vel", "clock"];
  private readonly b = board("keys");
  private readonly trim: number;
  private pitch = (_v: number) => 0;
  private gate = (_v: number) => 0;
  private vel = (_v: number) => 0;
  private clk = (_v: number) => 0;
  private div = 12;
  private held: number[] = [];
  private code = 0;
  private velCode = 0;
  private bpm = 120;
  private beat = 0;
  constructor(private readonly sampleRate: number, k: Record<string, number>) {
    const r = (n: string) => value(this.b, n);
    // RT1 (between PT and the inverting input) plus R4 against R3: a gain of two when RT1 is R3 less R4.
    this.trim = Math.min(1, Math.max(0, (r("R3") - r("R4")) / r("RT1")));
    this.knobs(k);
  }
  knobs(k: Record<string, number>) {
    const b = turned("keys", this.b, { ...knobsOf("keys"), ...k }, { RT1: this.trim });
    this.pitch = line(gains(netOf(b, ["R3", "R4", "R5", "RT1", "U5A"]), ["DAC_A"], ["PITCH"]));
    this.gate = line(gains(netOf(b, ["R6", "R7", "R8", "U5B"]), ["GATE5"], ["GATE"]));
    this.vel = line(gains(netOf(b, ["R9", "R10", "R11", "U5C"]), ["DAC_B"], ["VEL"]));
    this.clk = line(gains(netOf(b, ["R12", "R13", "R14", "U5D"]), ["CLK5"], ["CLOCK"]));
    // The Div knob's wiper on the microcontroller's ADC, in thirds.
    const p = part(b, "RV1"), turn = p.kind === "Pot" ? potShare(p) : 0.5;
    this.div = DIVS[Math.min(DIVS.length - 1, Math.floor(turn * DIVS.length))];
  }
  note(midi: number, vel: number) {
    this.held = this.held.filter((n) => n !== midi);
    if (vel > 0) { this.held.push(midi); this.velCode = Math.min(DAC_TOP, Math.round(vel * DAC_TOP)); }
    const last = this.held.at(-1);
    if (last !== undefined) this.code = Math.min(DAC_TOP, Math.max(0, Math.round((last - KEYS_BASE) / 12 / 2 / DAC_STEP)));
  }
  tempo(bpm: number, beat: number | null) {
    this.bpm = bpm;
    if (beat !== null) this.beat = beat;
  }
  step(_x: Float64Array, y: Float64Array) {
    this.beat += this.bpm / 60 / this.sampleRate;
    const tick = Math.floor(this.beat * PPQN), d = this.div;
    const on = this.held.length > 0;
    y[0] = this.pitch(this.code * DAC_STEP);
    y[1] = this.gate(on ? 5 : 0);
    y[2] = this.vel(this.velCode * DAC_STEP);
    y[3] = this.clk((((tick % d) + d) % d) < d / 2 ? 5 : 0);
  }
  read() { return { note: this.held.at(-1) ?? -1, dacA: this.code, dacB: this.velCode, pitch: this.pitch(this.code * DAC_STEP), bpm: this.bpm, div: this.div, beat: this.beat }; }
}

/** The SA571's own parts (onsemi's datasheet): R1 into the rectifier, R2 into the gain cell, R3, and the cell's bias. */
const SA571 = { r1: 10e3, r2: 20e3, r3: 20e3, ib: 140e-6 };
/** Its unity-gain level: the rectified average at which the compressor and the expander pass a signal as it is. */
const COMPANDER_UNITY = (SA571.r1 * SA571.r2 * SA571.ib) / (2 * SA571.r3);
/** The least average its rectifier sees: its bias current (under 0.1 uA, the datasheet) through R1. */
const RECT_FLOOR = 0.1e-6 * SA571.r1;
/** Its output's swing about where it rests (5.8 V and 3 V on 12 V): from a volt over ground to a volt under 12. */
const COMP_SWING = 4.8, EXP_LOW = -2, EXP_HIGH = 8;
/** The V3208D (Coolaudio's datasheet): 2048 stages; 2.5% distortion at 0.36 V rms, which is a tanh knee at 0.93 V. */
const BBD_STAGES = 2048, BBD_KNEE = 0.93;
/** Q Brigade's own rail (U5, an LM78L09) and the CD4046 VCO's stray capacitance, which adds to C20. */
const V9 = 9, VCO_STRAY = 32e-12;

/** A unity-gain Sallen-Key low-pass from its two resistors and its feedback and ground capacitors. */
function sallenKey(r1: number, r2: number, cf: number, cg: number, sampleRate: number): Biquad {
  const rc = Math.sqrt(r1 * r2 * cf * cg);
  return Biquad.make("lp", 1 / (2 * Math.PI * rc), rc / (cg * (r1 + r2)), sampleRate);
}

/**
 * Q Brigade: the board's signal path a sample at a time, every number from its parts. In and the repeats through
 * U1A's gains; the SA571's compressor, its output divided by its own rectified average (C4 the averaging), so a level
 * halves in decibels; U1B's anti-alias corner; the V3208D's 1024 buckets (gear's `Brigade`) moved at the clock, bent
 * past the datasheet's swing; the outputs' divider into U1C's reconstruction; the expander, its input times its average
 * (C16), undoing the compressor; U1D's gain to WET, and Mix's gains to Out. The clock: Time, Mod (the LFO, read off
 * R22 to R24, Rate and C18 as Q Wobble's) and Time CV through U4C's gains, clamped onto the CD4046's VCO, whose
 * rate runs from 1 / (R31 (C20 + 32 pF)) at 0 V to that plus 1 / (R30 (C20 + 32 pF)) at 9 V; U7 halves it. The
 * delay is the chip's stages over twice its clock. C1 into the compressor's own R3 keeps DC (a CV, an offset) out of
 * it; the other AC couplings, all under 2 Hz between audio stages, are left out.
 */
class Bbd implements Sim {
  readonly ins = ["in", "cv"];
  readonly outs = ["out"];
  private readonly b = board("bbd");
  private readonly chip = new Brigade(BBD_STAGES / 2);
  private readonly aa: Biquad;
  private readonly recon: Biquad;
  private readonly dcBlock: number;
  private readonly compAvg: number;
  private readonly expAvg: number;
  private readonly vcoAvg: number;
  private readonly fMin: number;
  private readonly fSpan: number;
  private readonly outShare: number;
  private readonly tri: number;
  private sum = (_i: number, _w: number) => 0;
  private ctl = (_t: number, _cv: number) => 0;
  private wetGain = 0;
  private mix = (_i: number, _w: number) => 0;
  private hz = 1;
  private phase = 0;
  private envC = RECT_FLOOR;
  private envE = RECT_FLOOR;
  private comp = 0;
  private dc = 0;
  private vcoIn = 0;
  private clock = 0;
  private wet = 0;
  constructor(private readonly sampleRate: number, k: Record<string, number>) {
    const r = (n: string) => value(this.b, n);
    this.aa = sallenKey(r("R7"), r("R8"), r("C6"), r("C7"), sampleRate);
    this.recon = sallenKey(r("R17"), r("R18"), r("C12"), r("C13"), sampleRate);
    this.dcBlock = pole(SA571.r3 * r("C1"), sampleRate);
    // Each SA571 rectifier averages through its own 10k into its capacitor.
    this.compAvg = pole(SA571.r1 * r("C4"), sampleRate);
    this.expAvg = pole(SA571.r1 * r("C16"), sampleRate);
    this.vcoAvg = pole(r("R29") * r("C19"), sampleRate);
    const c = r("C20") + VCO_STRAY;
    this.fMin = 1 / (r("R31") * c);
    this.fSpan = 1 / (r("R30") * c);
    // The chip's two outputs through R14 and R15 into R16.
    const src = (r("R14") * r("R15")) / (r("R14") + r("R15"));
    this.outShare = r("R16") / (r("R16") + src);
    this.tri = (RAIL * r("R23")) / r("R24");
    this.knobs(k);
  }
  knobs(k: Record<string, number>) {
    const b = turned("bbd", this.b, { ...knobsOf("bbd"), ...k }), r = (n: string) => value(b, n);
    const two = (g: Gains) => (x: number, w: number) => g.gain[0][0] * x + g.gain[0][1] * w + g.offset[0];
    this.sum = two(gains(netOf(b, ["R1", "R2", "R3", "RV2", "U1A"]), ["IN", "WET"], ["SUMO"]));
    this.ctl = two(gains(netOf(b, ["R25", "R26", "R27", "R28", "RV1", "RV3", "U4C"]), ["TRI", "CV"], ["CTL"]));
    this.wetGain = gains(netOf(b, ["R19", "R20", "U1D"]), ["EAC"], ["WET"]).gain[0][0];
    this.mix = two(gains(netOf(b, ["RV5", "U4D", "R21"]), ["IN", "WET"], ["OUT"]));
    this.hz = r("R24") / (4 * r("R23") * (r("R22") + rheostat(b, "RV4")) * r("C18"));
  }
  /** The VCO's rate at VCO In, and the chip's clock: half of it. */
  private clockAt(v: number) { return (this.fMin + (this.fSpan * clamp(v, 0, V9)) / V9) / 2; }
  step(x: Float64Array, y: Float64Array) {
    // The LFO, as Q Wobble's.
    this.phase = (this.phase + this.hz / this.sampleRate) % 1;
    const t = this.phase, tri = t < 0.5 ? this.tri * (1 - 4 * t) : this.tri * (4 * t - 3);
    // The clock: U4C's sum clamped by D1 and D2, smoothed by R29 and C19.
    const ctl = clamp(this.ctl(tri, x[1]), -RAIL, RAIL);
    this.vcoIn += this.vcoAvg * (clamp(ctl, -SCHOTTKY, V9 + SCHOTTKY) - this.vcoIn);
    this.clock = this.clockAt(this.vcoIn);
    // In and the repeats, then the compressor: the gain cell in its op-amp's feedback, so out = in x unity / average(out).
    const sum = clamp(this.sum(x[0], this.wet), -RAIL, RAIL);
    this.dc += this.dcBlock * (sum - this.dc);
    const u = sum - this.dc;
    const c = clamp((-u * COMPANDER_UNITY) / Math.max(this.envC, RECT_FLOOR), -COMP_SWING, COMP_SWING);
    this.envC += this.compAvg * (Math.abs(c) - this.envC);
    this.comp = c;
    // Through the chip, bent where it runs out of swing.
    const into = this.aa.run(c);
    const held = this.chip.run(BBD_KNEE * Math.tanh(into / BBD_KNEE), this.clock / this.sampleRate);
    const back = this.recon.run(held * this.outShare);
    // The expander: out = in x average(in) / unity, inverting.
    this.envE += this.expAvg * (Math.abs(back) - this.envE);
    const e = clamp((-back * Math.max(this.envE, RECT_FLOOR)) / COMPANDER_UNITY, EXP_LOW, EXP_HIGH);
    this.wet = clamp(this.wetGain * e, -RAIL, RAIL);
    y[0] = clamp(this.mix(x[0], this.wet), -RAIL, RAIL);
  }
  /** The delay now (the chip's stages over twice its clock), the clock, the LFO's rate and the compressed level. */
  read() { return { ms: (BBD_STAGES / (2 * this.clock)) * 1000, clock: this.clock, lfo: this.hz, vcoIn: this.vcoIn, comp: this.comp }; }
  /** The delay's range on this board, ms: Time and CV's whole sweep, from the VCO at 9 V to the VCO at 0 V. */
  range(): [number, number] { return [BBD_STAGES / (2 * this.clockAt(V9)) * 1000, BBD_STAGES / (2 * this.clockAt(0)) * 1000]; }
}

/** A module of `kind` at these knobs. */
export function makeSim(kind: string, sampleRate: number, knobs: Record<string, number> = {}): Sim {
  switch (kind) {
    case "vco": return new Vco(sampleRate, knobs);
    case "keys": return new Keys(sampleRate, knobs);
    case "bbd": return new Bbd(sampleRate, knobs);
    case "lfo": return new Lfo(sampleRate, knobs);
    case "seq": return new Seq(sampleRate, knobs);
    case "env": return new Env(sampleRate, knobs);
    case "vca": return new Vca(sampleRate, knobs);
    case "vcf": return new Vcf(sampleRate, knobs);
    case "noise": return new Noise(sampleRate, knobs);
    case "mix": case "out": return new Linear(kind, knobs);
  }
  throw new Error(`no sound wall module ${kind}`);
}
export { Linear };
