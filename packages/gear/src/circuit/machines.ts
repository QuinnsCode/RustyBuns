// Effects that are machines as well as circuits: a spring tank, a tape echo and
// a bucket-brigade chip. The tubes and op-amps around them are netlists the
// solver runs (circuits.ts); the spring, the tape and the chip are blocks of
// their own, written from published models. They sit in the amp's effects loop
// (`RigSpec.loop`), after the preamp and before the power stage, and run at the
// output sample rate on line-level volts (about ±1).
//
// Sources: Välimäki, Parker & Abel (2010), "Parametric spring reverberation
// effect"; Chowdhury (2019), "Real-time physical modelling for analog tape
// machines" (Jiles-Atherton hysteresis, head losses); Holters & Parker (2018),
// "A combined model for a bucket brigade device and its input and output filters".
import { Biquad, chain } from "./filters.ts";
import { Circuit, type Netlist, type Part } from "./mna.ts";

// @rustybuns/gear has no dependencies, so @rustybuns/util's seeded mulberry32 is copied here, not imported.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    let t = (a = (a + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The circuits inside the machines: a spring tank's driver and recovery tubes, a tape echo's record amp.
const R = (a: string, b: string, ohms: number): Part => ({ kind: "R", a, b, ohms });
const C = (a: string, b: string, farads: number): Part => ({ kind: "C", a, b, farads });

/**
 * A spring tank's driver: a 12AT7 (lower gain, more current than a 12AX7) with
 * a bypassed cathode, its plate into the tank transformer's primary, taken as
 * its impedance at mid frequencies, 22k to B+; the transformer itself is in `SpringReverb`.
 */
export function springDriver(): Netlist {
  return {
    input: "IN", output: "OUT",
    parts: [
      C("IN", "a", 47e-9), R("a", "gnd", 1e6), R("a", "g", 10e3),
      { kind: "Triode", p: "OUT", g: "g", k: "k", tube: "12AT7" },
      R("k", "gnd", 2.2e3), C("k", "gnd", 25e-6),
      { kind: "V", a: "bplus", b: "gnd", volts: 250 }, R("bplus", "OUT", 22e3),
    ],
  };
}

/** The recovery stage: a 12AX7 (100k plate, bypassed 1.5k cathode, a small coupling cap) lifting the tank's millivolts back to line level. */
export function springRecovery(): Netlist {
  return {
    input: "IN", output: "OUT",
    parts: [
      C("IN", "a", 4.7e-9), R("a", "gnd", 1e6), R("a", "g", 68e3),
      { kind: "Triode", p: "OUT", g: "g", k: "k" }, R("k", "gnd", 1.5e3), C("k", "gnd", 25e-6),
      { kind: "V", a: "bplus", b: "gnd", volts: 300 }, R("bplus", "OUT", 100e3),
    ],
  };
}

/**
 * A tape echo's record amp: an op-amp at ×4 on ±4 V rails. The echoes feed back
 * through it, so a runaway flattens on the rails instead of growing forever.
 */
export function recordAmp(): Netlist {
  return {
    input: "IN", output: "OUT",
    parts: [
      C("IN", "inp", 1e-6), R("inp", "gnd", 100e3),
      { kind: "Opamp", plus: "inp", minus: "inn", out: "OUT" },
      R("OUT", "inn", 30e3), R("inn", "gnd", 10e3), C("OUT", "inn", 100e-12),
    ],
  };
}

/** Knobs run 0 to 10, as on the panel. */
export type SpringSpec = { kind: "spring"; dwell: number; mix: number };
/** `heads` are which of the three playback heads play (1 is nearest the record head). */
export type TapeSpec = { kind: "tape"; time: number; repeats: number; mix: number; heads: number[] };
export type BbdMode = "chorus" | "flanger" | "delay";
export type BbdSpec = { kind: "bbd"; mode: BbdMode; rate: number; depth: number };
export type LoopSpec = SpringSpec | TapeSpec | BbdSpec;

/** One machine in the loop: a line-level sample in, one out. `set` turns its knobs. */
export interface Machine {
  readonly kind: LoopSpec["kind"];
  run(x: number): number;
  set(spec: LoopSpec): void;
  readonly misses: number;
  /** Its LFO this far on (radians), if it has one: a stereo pair's right side runs half a turn behind. */
  turn?(radians: number): void;
}

/**
 * The circuits inside the machines, in place of the ones written here (`springDriver`, `springRecovery`,
 * `recordAmp`): FM DAW reads its own from tscircuit boards. Each takes the input and output roles of the one it replaces.
 */
export interface MachineCircuits { springDriver?: Netlist; springRecovery?: Netlist; recordAmp?: Netlist }

export function machine(spec: LoopSpec, sampleRate: number, circuits: MachineCircuits = {}): Machine {
  const m = spec.kind === "spring" ? new SpringReverb(sampleRate, circuits) : spec.kind === "tape" ? new TapeEcho(sampleRate, circuits) : new Bbd(sampleRate);
  m.set(spec);
  return m;
}

/** A circuit as a block: its swing around where it rests. */
class Stage {
  private c: Circuit;
  private rest: number;
  constructor(net: Netlist, sr: number) { this.c = new Circuit(net, sr); this.rest = this.c.settle(0); }
  run(x: number): number { return this.c.step(x) - this.rest; }
  get misses(): number { return this.c.misses; }
}

// ---- spring reverb ----

/**
 * One spring as a feedback loop (Välimäki, Parker & Abel 2010, the low-frequency
 * path): a delay line for the wave's trip down the spring and back, then a chain
 * of stretched all-pass filters, A(z) = (a + z^-K) / (1 + a z^-K), that hold low
 * notes back longer than high ones. The spring's dispersion: a click comes out
 * as a falling chirp, the "boing". K stretches the dispersion up to the
 * transition frequency fs / 2K; a low-pass there cuts the copies above it.
 */
export class Spring {
  private line: Float64Array;
  private at = 0;
  private ap: Float64Array;
  private apAt = 0;
  private K: number;
  private lp: Biquad[];
  private fb = 0;
  constructor(sr: number, seconds: number, private gain: number, private a = -0.6, stages = 100, transitionHz = 4300) {
    this.K = Math.max(1, Math.round(sr / (2 * transitionHz)));
    this.ap = new Float64Array(stages * this.K);
    this.line = new Float64Array(Math.max(1, Math.round(sr * seconds)));
    this.lp = [Biquad.make("lp", transitionHz, 0.6, sr), Biquad.make("lp", transitionHz, 1.3, sr)];
  }
  run(x: number): number {
    const { line, ap, K, a } = this;
    let y = line[this.at];
    line[this.at] = x + this.gain * this.fb;
    this.at = (this.at + 1) % line.length;
    // Every stage has the same K, so one write position serves them all.
    const p = this.apAt;
    for (let i = p; i < ap.length; i += K) {
      const old = ap[i], w = y - a * old;
      ap[i] = w;
      y = a * w + old;
    }
    this.apAt = (p + 1) % K;
    this.fb = chain(this.lp, y);
    return this.fb;
  }
}

/**
 * The reverb: a 12AT7 drives a transformer into a tank of two springs, a
 * 12AX7 reads it back, and Mix adds that to the dry signal. Dwell is how hard
 * the driver is pushed: high, and a loud chord crashes the transformer's core.
 * The transformer is a stand-in until the solver has inductors (#4826): its
 * primary's inductance as a high-pass, its core as a soft ceiling.
 */
export class SpringReverb implements Machine {
  readonly kind = "spring";
  private driver: Stage;
  private recovery: Stage;
  private springs: Spring[];
  private transformer: Biquad;
  private dwell = 0.5;
  private mix = 0.4;
  constructor(sr: number, circuits: MachineCircuits = {}) {
    this.driver = new Stage(circuits.springDriver ?? springDriver(), sr);
    this.recovery = new Stage(circuits.springRecovery ?? springRecovery(), sr);
    // Two springs of different lengths (a long and a short tank), so their echoes don't line up.
    this.springs = [new Spring(sr, 0.0331, 0.72), new Spring(sr, 0.0413, 0.68)];
    this.transformer = Biquad.make("hp", 180, 0.7, sr);
  }
  set(spec: LoopSpec): void {
    if (spec.kind !== "spring") return;
    this.dwell = 0.05 + (spec.dwell / 10) ** 2 * 4;
    this.mix = spec.mix / 10;
  }
  run(x: number): number {
    // Plate swing in volts (tens of them at full Dwell) into the transformer.
    const plate = this.driver.run(x * this.dwell);
    const core = 30 * Math.tanh(this.transformer.run(plate) / 30);
    let tank = 0;
    for (const s of this.springs) tank += s.run(core * 1e-3); // the tank gives back millivolts
    return x + this.mix * 0.6 * this.recovery.run(tank);
  }
  get misses(): number { return this.driver.misses + this.recovery.misses; }
}

// ---- tape echo ----

/** Langevin's function coth(q) − 1/q and its slope, safe near 0. */
function langevin(q: number): [number, number] {
  if (Math.abs(q) < 1e-3) return [q / 3, 1 / 3 - (q * q) / 15];
  const sh = Math.sinh(q);
  return [1 / Math.tanh(q) - 1 / q, 1 / (q * q) - 1 / (sh * sh)];
}

/**
 * Magnetic tape on record: the Jiles-Atherton hysteresis loop, solved per
 * sample with Runge-Kutta (2nd order) at 2× steps, as in Chowdhury (2019).
 * H is the record head's field, M the tape's magnetisation. Push it and it
 * squashes and loses highs; its loop is why tape compresses softly.
 */
export class Hysteresis {
  M = 0;
  private H = 0;
  private Hd = 0;
  // Chowdhury's constants for audio tape (A/m); c, the reversible share, is his plugin's default
  // (width 0.5): it keeps quiet notes linear, as AC bias does on a real machine.
  constructor(private sr: number, private Ms = 3.5e5, private a = 2.2e4, private alpha = 1.6e-3, private k = 2.7e4, private c = 0.7) {}
  private dMdt(M: number, H: number, Hd: number): number {
    const { Ms, a, alpha, k, c } = this;
    const [L, Ld] = langevin((H + alpha * M) / a);
    const dM = Ms * L - M, delta = Hd >= 0 ? 1 : -1;
    const irr = Math.sign(delta) === Math.sign(dM) ? ((1 - c) * dM) / ((1 - c) * delta * k - alpha * dM) : 0;
    const rev = (c * Ms * Ld) / a;
    return (Hd * (Number.isFinite(irr) ? irr + rev : rev)) / (1 - (c * alpha * Ms * Ld) / a);
  }
  /** One sample of field `H` (A/m) in, the magnetisation out (A/m). */
  run(H: number): number {
    const T = 1 / (2 * this.sr);
    for (let s = 1; s <= 2; s++) {
      const h1 = this.H + ((H - this.H) * s) / 2, h0 = this.H + ((H - this.H) * (s - 1)) / 2;
      const Hd = (h1 - h0) / T, Hmid = (h0 + h1) / 2, HdMid = (Hd + this.Hd) / 2;
      const k1 = this.dMdt(this.M, h0, HdMid);
      const k2 = this.dMdt(this.M + (T / 2) * k1, Hmid, Hd);
      this.M += T * k2;
      this.Hd = Hd;
    }
    this.H = H;
    if (!Number.isFinite(this.M)) this.M = 0;
    this.M = Math.max(-this.Ms, Math.min(this.Ms, this.M));
    return this.M;
  }
}

/** Head loss at `hz` for tape at `speed` m/s: spacing loss e^(−kd) times the gap's sinc (Chowdhury 2019, after Bertram). */
export function headLoss(hz: number, speed: number, spacing = 2e-6, gap = 6e-6): number {
  const k = (2 * Math.PI * hz) / speed, x = (k * gap) / 2;
  return Math.exp(-k * spacing) * (x < 1e-9 ? 1 : Math.abs(Math.sin(x) / x));
}

/** Where the head loss falls to −3 dB, by bisection. */
function lossCorner(speed: number, top: number): number {
  let lo = 20, hi = top;
  if (headLoss(hi, speed) > Math.SQRT1_2) return hi;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (headLoss(mid, speed) > Math.SQRT1_2) lo = mid; else hi = mid; }
  return lo;
}

/** The three playback heads, in metres of tape after the record head. */
const HEAD_GAPS = [0.019, 0.038, 0.057];
const NOMINAL_SPEED = 0.19; // 7.5 inches a second

/**
 * A tape echo: the record amp's circuit, hysteresis onto a tape loop, three
 * playback heads with their losses, wow and flutter, and a motor whose speed
 * follows the Time knob with inertia, so the echoes slide in pitch as you turn
 * it. Repeats feeds the heads back through the record amp; past about 8 a
 * repeat comes back louder than it went in and runs away, until the record amp's
 * rails and the tape's saturation hold it there.
 */
export class TapeEcho implements Machine {
  readonly kind = "tape";
  private tape: Float32Array;
  private at = 0;
  private record: Stage;
  private tapeM: Hysteresis;
  private loss: Biquad[];
  private dc: Biquad;
  private speed = NOMINAL_SPEED;
  private target = NOMINAL_SPEED;
  private glide: number;
  private t = 0;
  private flutter = 0;
  private rand = mulberry32(1);
  private fb = 0;
  private repeats = 0.4;
  private mix = 0.4;
  private heads = [1, 0, 1];
  private tuned = 0;
  constructor(private sr: number, circuits: MachineCircuits = {}) {
    this.record = new Stage(circuits.recordAmp ?? recordAmp(), sr);
    this.tapeM = new Hysteresis(sr);
    // Longest echo: the far head at the slowest speed, plus room for wow.
    this.tape = new Float32Array(Math.ceil(sr * (HEAD_GAPS[2] / (NOMINAL_SPEED / 4)) * 1.1) + 8);
    this.loss = [Biquad.make("lp", 5000, 0.6, sr), Biquad.make("lp", 5000, 1.3, sr)];
    this.dc = Biquad.make("hp", 60, 0.7, sr);
    this.glide = 1 - Math.exp(-1 / (0.35 * sr)); // the motor takes about a third of a second
  }
  set(spec: LoopSpec): void {
    if (spec.kind !== "tape") return;
    // Time 0 is the fastest tape (shortest echo), 10 the slowest: a quarter of the speed.
    this.target = NOMINAL_SPEED / (1 + (3 * spec.time) / 10);
    this.repeats = (spec.repeats / 10) * 1.3;
    this.mix = spec.mix / 10;
    this.heads = [1, 2, 3].map((h) => (spec.heads.includes(h) ? 1 : 0));
  }
  get tapeSpeed(): number { return this.speed; }
  run(x: number): number {
    const { tape, sr } = this;
    this.speed += (this.target - this.speed) * this.glide;
    // The loss filter follows the speed (slow tape loses more highs); retuning per 64 samples is plenty.
    if (++this.tuned >= 64) {
      this.tuned = 0;
      const hz = lossCorner(this.speed, 0.45 * sr);
      this.loss[0].retune(Biquad.make("lp", hz, 0.6, sr)); this.loss[1].retune(Biquad.make("lp", hz, 1.3, sr));
    }
    // Wow (the capstan's wobble, slow) and flutter (fast, a bit random).
    this.t += 1 / sr;
    this.flutter += (this.rand() - 0.5 - this.flutter) * 0.002;
    const wander = 1 + 0.0025 * Math.sin(2 * Math.PI * 0.55 * this.t) + 0.0008 * Math.sin(2 * Math.PI * 7.3 * this.t) + 0.004 * this.flutter;
    let wet = 0;
    for (let h = 0; h < 3; h++) {
      if (!this.heads[h]) continue;
      wet += read(tape, this.at, ((HEAD_GAPS[h] / this.speed) * sr) * wander);
    }
    wet = chain(this.loss, wet);
    // Record: dry plus the repeats, through the record amp, as a field on the head, onto the tape.
    const amp = this.record.run(x + this.fb * this.repeats);
    tape[this.at] = this.tapeM.run(amp * 1.2e4) / 1.8e5; // unity echo below about 1 V
    this.at = (this.at + 1) % tape.length;
    this.fb = this.dc.run(wet);
    return x + this.mix * wet;
  }
  get misses(): number { return this.record.misses; }
}

/** A Hermite-cubic read `delay` samples behind the write head at `at`. */
function read(buf: Float32Array, at: number, delay: number): number {
  const n = buf.length, pos = at - delay + 2 * n, i = Math.floor(pos), f = pos - i;
  const y0 = buf[(i - 1) % n], y1 = buf[i % n], y2 = buf[(i + 1) % n], y3 = buf[(i + 2) % n];
  const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * f + c2) * f + c1) * f + y1;
}

// ---- bucket brigade ----

const BBD_MODES: Record<BbdMode, { stages: number; ms: [number, number]; lfoHz: [number, number]; feedback: number; wet: number; filterHz: number }> = {
  // Delay range across the sweep, LFO speed range across Rate.
  chorus: { stages: 1024, ms: [4, 12], lfoHz: [0.1, 3], feedback: 0, wet: 0.7, filterHz: 9000 },
  flanger: { stages: 1024, ms: [0.6, 6], lfoHz: [0.05, 1], feedback: 0.65, wet: 0.7, filterHz: 9000 },
  // Delay: Rate is the time, Depth the repeats; a 4096-stage chip clocked slow, so the filters close down.
  delay: { stages: 4096, ms: [60, 330], lfoHz: [0.3, 0.3], feedback: 0, wet: 0.6, filterHz: 3200 },
};

/**
 * A bucket-brigade chip: N capacitors that pass a sample down one step per
 * clock tick, so the delay is N / (2 · clock). The clock comes from an LFO, so
 * the delay sweeps (chorus, flanger) or holds still (delay). Around it, as on
 * the boards (Holters & Parker 2018): an anti-aliasing filter in, a
 * reconstruction filter out, and a compander (2:1 in, 1:2 out) that hides
 * the chip's hiss and breathes a little. The clock jitters, which is its noise.
 */
export class Bbd implements Machine {
  readonly kind = "bbd";
  private buckets = new Float64Array(4096 / 2);
  private n = 512;
  private bAt = 0;
  private phase = 0;
  private held = 0;
  private prevIn = 0;
  private aa: Biquad[] = [];
  private recon: Biquad[] = [];
  private envIn = 1e-4;
  private envOut = 1e-4;
  private lfo = 0;
  private fb = 0;
  private rand = mulberry32(7);
  private mode: BbdMode = "chorus";
  private rate = 0.4;
  private depth = 0.5;
  private atk: number;
  private rel: number;
  constructor(private sr: number) {
    this.atk = 1 - Math.exp(-1 / (0.004 * sr));
    this.rel = 1 - Math.exp(-1 / (0.03 * sr));
    this.setMode("chorus");
  }
  private setMode(mode: BbdMode) {
    const m = BBD_MODES[mode], sr = this.sr;
    this.mode = mode;
    this.n = m.stages / 2;
    this.buckets.fill(0);
    this.aa = [Biquad.make("lp", m.filterHz, 0.54, sr), Biquad.make("lp", m.filterHz, 1.31, sr)];
    this.recon = [Biquad.make("lp", m.filterHz, 0.54, sr), Biquad.make("lp", m.filterHz, 1.31, sr)];
  }
  set(spec: LoopSpec): void {
    if (spec.kind !== "bbd") return;
    if (spec.mode !== this.mode) this.setMode(spec.mode);
    this.rate = spec.rate / 10;
    this.depth = spec.depth / 10;
  }
  turn(radians: number): void { const tau = 2 * Math.PI; this.lfo = (((this.lfo + radians) % tau) + tau) % tau; }
  /** The delay now, in seconds. */
  delaySeconds(): number {
    const m = BBD_MODES[this.mode];
    if (this.mode === "delay") return (m.ms[0] + (m.ms[1] - m.ms[0]) * this.rate) / 1000;
    const sweep = 0.5 + 0.5 * Math.sin(this.lfo) * this.depth;
    return (m.ms[0] + (m.ms[1] - m.ms[0]) * sweep) / 1000;
  }
  run(x: number): number {
    const m = BBD_MODES[this.mode], sr = this.sr;
    if (this.mode !== "delay") this.lfo += (2 * Math.PI * (m.lfoHz[0] + (m.lfoHz[1] - m.lfoHz[0]) * this.rate)) / sr;
    if (this.lfo > 2 * Math.PI) this.lfo -= 2 * Math.PI;
    const feedback = this.mode === "delay" ? this.depth * 0.9 : m.feedback * this.depth;
    // Compressor: divide by the square root of the level, so 2:1 in decibels.
    let u = chain(this.aa, x + this.fb * feedback);
    this.envIn += (Math.abs(u) - this.envIn) * (Math.abs(u) > this.envIn ? this.atk : this.rel);
    u /= Math.sqrt(Math.max(this.envIn, 1e-4));
    // The clock: ticks per output sample, each one moving every bucket a step.
    const ticks = (this.n / this.delaySeconds()) / sr;
    this.phase += ticks;
    while (this.phase >= 1) {
      this.phase -= 1;
      // Sample the input where the tick falls (jittered a little), take out the oldest bucket.
      const f = Math.min(1, Math.max(0, 1 - this.phase / ticks + (this.rand() - 0.5) * 0.02));
      this.held = this.buckets[this.bAt] * 0.999 + (this.rand() - 0.5) * 2e-4; // a little charge lost, a little hiss
      this.buckets[this.bAt] = this.prevIn + (u - this.prevIn) * f;
      this.bAt = (this.bAt + 1) % this.n;
    }
    this.prevIn = u;
    // Reconstruction, then the expander: multiply by the level, undoing the square root.
    let y = chain(this.recon, this.held);
    this.envOut += (Math.abs(y) - this.envOut) * (Math.abs(y) > this.envOut ? this.atk : this.rel);
    y *= Math.max(this.envOut, 1e-4) * 0.89; // so a steady note comes back at its own level
    this.fb = y;
    return this.mode === "delay" ? x + m.wet * y : (1 - m.wet * 0.5) * x + m.wet * y;
  }
  readonly misses = 0;
}
