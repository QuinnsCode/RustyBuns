// A guitar rig: circuits in a row (pedals, tube stages, tone stack), run 4×
// oversampled so the clipping's harmonics don't fold back down as fizz, then a
// power stage and a speaker-cabinet EQ. `Rig` streams block by block (the amp
// page's audio thread runs it); `runRig` does a whole buffer at once.
import { Circuit, type Netlist } from "./mna.ts";

/** RBJ cookbook biquad, transposed direct form II. */
class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(private b0: number, private b1: number, private b2: number, private a1: number, private a2: number) {}
  static make(kind: "lp" | "hp" | "peak", hz: number, q: number, sr: number, db = 0): Biquad {
    const w = (2 * Math.PI * hz) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
    if (kind === "peak") {
      const A = 10 ** (db / 40), a0 = 1 + al / A;
      return new Biquad((1 + al * A) / a0, (-2 * cw) / a0, (1 - al * A) / a0, (-2 * cw) / a0, (1 - al / A) / a0);
    }
    const a0 = 1 + al, k = kind === "lp" ? (1 - cw) / 2 : (1 + cw) / 2, s = kind === "lp" ? 1 : -1;
    return new Biquad(k / a0, (s * 2 * k) / a0, k / a0, (-2 * cw) / a0, (1 - al) / a0);
  }
  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

const chain = (fs: Biquad[], x: number) => { for (const f of fs) x = f.run(x); return x; };
/** 8th-order Butterworth low-pass as four biquads (the Q of each pole pair). */
const butter8 = (hz: number, sr: number) => [0.5098, 0.6013, 0.9, 2.5629].map((q) => Biquad.make("lp", hz, q, sr));

/**
 * What moves one of a circuit's `VarR` controls, once a sample: an LFO (`hz`), or the link's own output
 * swing times `sens` (an envelope: a compressor's LED, an auto-wah). It runs 0 to 1, is mapped onto
 * `from`..`to` (default 0..1), raised to `pow` (a lamp's light climbs faster than its current), then
 * through each `lag`, `[rise, fall]` in seconds: a lamp heating and cooling, an LDR that darkens fast and
 * recovers slowly. Those lags, not the LFO, are where an optical effect's sound comes from.
 */
export interface Mod { ctl: string; hz?: number; sens?: number; from?: number; to?: number; pow?: number; lag?: [number, number][] }

/** A link in the rig: a circuit, with an optional volume pot (0 to 1) ahead of it, and what moves its controls. */
export interface Link { net: Netlist; gain?: number; mods?: Mod[] }

/** A `Mod` running on one circuit at the rig's sample rate. */
class ModRun {
  phase = 0;
  private ys: Float64Array;
  private coef: [number, number][];
  readonly slot: number;
  constructor(readonly m: Mod, circuit: Circuit, sampleRate: number) {
    this.slot = circuit.controlSlot(m.ctl);
    const a = (sec: number) => (sec > 0 ? 1 - Math.exp(-1 / (sec * sampleRate)) : 1);
    this.coef = (m.lag ?? []).map(([up, down]) => [a(up), a(down)]);
    this.ys = new Float64Array(this.coef.length).fill(this.shape(0));
  }
  private shape(raw: number): number {
    const { from = 0, to = 1, pow = 1 } = this.m;
    const v = from + (to - from) * Math.min(1, Math.max(0, raw));
    return pow === 1 ? v : v ** pow;
  }
  /** The value at rest (before a sample has run). */
  get rest(): number { return this.ys.length ? this.ys[this.ys.length - 1] : this.shape(0); }
  /** One sample: `swing` is the link's last output swing in volts. */
  step(swing: number, sampleRate: number): number {
    const m = this.m;
    let raw = 0;
    if (m.hz) {
      raw = 0.5 - 0.5 * Math.cos(this.phase);
      this.phase += (2 * Math.PI * m.hz) / sampleRate;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
    } else raw = swing * (m.sens ?? 1);
    let y = this.shape(raw);
    for (let k = 0; k < this.coef.length; k++) {
      const prev = this.ys[k];
      y = this.ys[k] = prev + (y > prev ? this.coef[k][0] : this.coef[k][1]) * (y - prev);
    }
    return y;
  }
}

export interface RigSpec {
  /** Volts at the input for a full-scale sample: a guitar pickup peaks around 0.1 to 1 V. */
  inputVolts: number;
  links: Link[];
  /** Power-stage drive (0 for none): a soft tanh standing in for the output tubes and transformer. */
  power: number;
  /** Speaker-cabinet EQ on the way out. */
  cab: boolean;
  /** How loud the noisy resistors hiss (each `Circuit`'s `noise`); 0 or left out is silent. */
  noise?: number;
}

export interface RigRun {
  out: Float32Array;
  /** Samples (at the oversampled rate) where a circuit's Newton solve gave up. */
  misses: number;
  /** Average Newton iterations per circuit step. */
  iterationsPerStep: number;
}

/** The power stage's ceiling, in volts: its `tanh` flattens out here. */
export const POWER_VOLTS = 40;

/**
 * A rig that streams: `process` a block at a time, and turn its knobs between
 * blocks. `setGain` is a volume pot (free), `setLink` swaps one circuit for
 * another with new part values (one matrix inversion and a rest solve), `setPower`
 * drives the power stage.
 */
export class Rig {
  private circuits: Circuit[];
  private gains: number[];
  private mods: ModRun[][];
  /** Each link's biggest swing over the last sample's oversampled steps: what an envelope `Mod` reads. */
  private swing: Float64Array;
  /** Each link's resting output voltage. */
  private rest: number[] = [];
  private peaks: Float64Array;
  private up: Biquad[];
  private down: Biquad[];
  private cab: Biquad[];
  private inputVolts: number;
  private power: number;
  private noise: number;
  private steps = 0;

  constructor(spec: RigSpec, readonly sampleRate = 48000, readonly oversample = 4) {
    const hi = sampleRate * oversample;
    this.inputVolts = spec.inputVolts;
    this.power = spec.power;
    this.gains = spec.links.map((l) => l.gain ?? 1);
    this.circuits = spec.links.map((l) => new Circuit(l.net, hi));
    this.noise = spec.noise ?? 0;
    for (const c of this.circuits) c.noise = this.noise;
    this.mods = spec.links.map((l, i) => this.startMods(i, l.mods));
    this.swing = new Float64Array(this.circuits.length);
    // Rest state, stage by stage: each one's input is the last one's resting output.
    this.circuits.forEach((c, i) => this.rest.push(c.settle(i ? this.rest[i - 1] : 0)));
    this.peaks = new Float64Array(this.circuits.length);
    this.up = butter8(0.45 * sampleRate, hi);
    this.down = butter8(0.45 * sampleRate, hi);
    this.cab = spec.cab
      ? [Biquad.make("hp", 75, 0.7, sampleRate), Biquad.make("peak", 120, 1, sampleRate, 4), Biquad.make("peak", 1800, 1.2, sampleRate, -3),
         Biquad.make("peak", 3000, 1.2, sampleRate, 3), Biquad.make("lp", 5000, 0.54, sampleRate), Biquad.make("lp", 5000, 1.31, sampleRate)]
      : [];
  }

  /** The volume pot ahead of link `i`, 0 to 1. */
  setGain(i: number, g: number): void { this.gains[i] = g; }
  setPower(p: number): void { this.power = p; }
  setNoise(n: number): void { this.noise = n; for (const c of this.circuits) c.noise = n; }

  /** Link `i` becomes `net` (same input and output roles), starting from its rest state. An LFO keeps its phase. */
  setLink(i: number, net: Netlist, mods?: Mod[]): void {
    const c = new Circuit(net, this.sampleRate * this.oversample);
    c.noise = this.noise;
    const old = this.mods[i];
    this.circuits[i] = c;
    this.mods[i] = this.startMods(i, mods);
    this.mods[i].forEach((m, k) => { if (old[k]) m.phase = old[k].phase; });
    this.rest[i] = c.settle(i ? this.rest[i - 1] : 0);
  }

  /** Link `i`'s mods, each control set to its resting value. */
  private startMods(i: number, mods: Mod[] = []): ModRun[] {
    const c = this.circuits[i];
    return mods.map((m) => {
      const r = new ModRun(m, c, this.sampleRate);
      if (r.slot < 0) throw new Error(`no part listens to control "${m.ctl}"`);
      c.setCtl(r.slot, r.rest);
      return r;
    });
  }

  /** Mono `n` samples from `input` (full scale ±1) to `output` (volts at the speaker). */
  process(input: Float32Array, output: Float32Array, n = input.length): void {
    const { circuits, gains, rest, peaks, up, down, cab, oversample, mods, swing, sampleRate } = this;
    const last = rest.length - 1;
    for (let s = 0; s < n; s++) {
      let acc = 0;
      for (let i = 0; i < mods.length; i++) {
        for (const m of mods[i]) circuits[i].setCtl(m.slot, m.step(swing[i], sampleRate));
        swing[i] = 0;
      }
      for (let k = 0; k < oversample; k++) {
        // Zero-stuffed upsampling: the sample, then silence, smoothed by the low-pass (×oversample keeps the level).
        let x = chain(up, k === 0 ? input[s] * this.inputVolts * oversample : 0);
        for (let i = 0; i < circuits.length; i++) {
          // A volume pot after the coupling cap: it scales the swing, not the resting voltage.
          const r = i ? rest[i - 1] : 0;
          x = circuits[i].step(r + (x - r) * gains[i]);
          const sw = Math.abs(x - rest[i]);
          if (sw > peaks[i]) peaks[i] = sw;
          if (sw > swing[i]) swing[i] = sw;
        }
        x -= rest[last];
        if (this.power > 0) x = Math.tanh((x * this.power) / POWER_VOLTS) * POWER_VOLTS;
        acc = chain(down, x);
      }
      output[s] = cab.length ? chain(cab, acc) : acc;
    }
    this.steps += n * oversample * circuits.length;
  }

  /** Each link's biggest swing (volts) since the last call, then cleared: what lights its tube. */
  levels(): number[] {
    const out = Array.from(this.peaks);
    this.peaks.fill(0);
    return out;
  }

  get misses(): number { return this.circuits.reduce((s, c) => s + c.misses, 0); }
  get iterationsPerStep(): number { return this.circuits.reduce((s, c) => s + c.iterations, 0) / Math.max(1, this.steps); }
}

/** Runs a mono buffer through a rig. Each call starts from the rig's resting state. */
export function runRig(spec: RigSpec, input: Float32Array, sampleRate = 48000, oversample = 4): RigRun {
  const rig = new Rig(spec, sampleRate, oversample);
  const out = new Float32Array(input.length);
  rig.process(input, out);
  return { out, misses: rig.misses, iterationsPerStep: rig.iterationsPerStep };
}
