// A guitar rig: circuits in a row (pedals, tube stages, tone stack), run 4×
// oversampled so the clipping's harmonics don't fold back down as fizz, then a
// power stage and a speaker-cabinet EQ. Between the preamp and the power stage
// sits the effects loop: machines (machines.ts) at the output rate, as on a real
// amp's send and return. `Rig` streams block by block (the amp
// page's audio thread runs it); `runRig` does a whole buffer at once.
import { Biquad, butter8, chain } from "./biquad.ts";
import { machine, type LoopSpec, type Machine } from "./machines.ts";
import { Circuit, type Netlist } from "./mna.ts";

/** A link in the rig: a circuit, with an optional volume pot (0 to 1) ahead of it. */
export interface Link { net: Netlist; gain?: number }

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
  /** The effects loop, in order: machines between the last link and the power stage. */
  loop?: LoopSpec[];
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
/** The loop's send pads the preamp's swing (about 125 V at the most) down to line level by this, and the return brings it back. */
export const LOOP_VOLTS = 100;

/**
 * A rig that streams: `process` a block at a time, and turn its knobs between
 * blocks. `setGain` is a volume pot (free), `setLink` swaps one circuit for
 * another with new part values (one matrix inversion and a rest solve), `setPower`
 * drives the power stage.
 */
export class Rig {
  private circuits: Circuit[];
  private gains: number[];
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
  private loop: Machine[] = [];
  // The return back up to the oversampled rate, so the power stage clips there as without a loop.
  private up2: Biquad[];
  private down2: Biquad[];

  constructor(spec: RigSpec, readonly sampleRate = 48000, readonly oversample = 4) {
    const hi = sampleRate * oversample;
    this.inputVolts = spec.inputVolts;
    this.power = spec.power;
    this.gains = spec.links.map((l) => l.gain ?? 1);
    this.circuits = spec.links.map((l) => new Circuit(l.net, hi));
    this.noise = spec.noise ?? 0;
    for (const c of this.circuits) c.noise = this.noise;
    // Rest state, stage by stage: each one's input is the last one's resting output.
    this.circuits.forEach((c, i) => this.rest.push(c.settle(i ? this.rest[i - 1] : 0)));
    this.peaks = new Float64Array(this.circuits.length);
    this.up = butter8(0.45 * sampleRate, hi);
    this.down = butter8(0.45 * sampleRate, hi);
    this.up2 = butter8(0.45 * sampleRate, hi);
    this.down2 = butter8(0.45 * sampleRate, hi);
    this.setLoop(spec.loop ?? []);
    this.cab = spec.cab
      ? [Biquad.make("hp", 75, 0.7, sampleRate), Biquad.make("peak", 120, 1, sampleRate, 4), Biquad.make("peak", 1800, 1.2, sampleRate, -3),
         Biquad.make("peak", 3000, 1.2, sampleRate, 3), Biquad.make("lp", 5000, 0.54, sampleRate), Biquad.make("lp", 5000, 1.31, sampleRate)]
      : [];
  }

  /** The volume pot ahead of link `i`, 0 to 1. */
  setGain(i: number, g: number): void { this.gains[i] = g; }
  setPower(p: number): void { this.power = p; }
  setNoise(n: number): void { this.noise = n; for (const c of this.circuits) c.noise = n; }

  /** The loop becomes `specs`: a machine already in it keeps its state (its tape, its springs) and just turns its knobs. */
  setLoop(specs: LoopSpec[]): void {
    const old = [...this.loop];
    this.loop = specs.map((sp) => {
      const at = old.findIndex((m) => m.kind === sp.kind);
      if (at < 0) return machine(sp, this.sampleRate);
      const [m] = old.splice(at, 1);
      m.set(sp);
      return m;
    });
  }

  /** Link `i` becomes `net` (same input and output roles), starting from its rest state. */
  setLink(i: number, net: Netlist): void {
    const c = new Circuit(net, this.sampleRate * this.oversample);
    c.noise = this.noise;
    this.rest[i] = c.settle(i ? this.rest[i - 1] : 0);
    this.circuits[i] = c;
  }

  /** Mono `n` samples from `input` (full scale ±1) to `output` (volts at the speaker). */
  process(input: Float32Array, output: Float32Array, n = input.length): void {
    const { circuits, gains, rest, peaks, up, down, up2, down2, cab, oversample, loop } = this;
    const looped = loop.length > 0;
    const last = rest.length - 1;
    for (let s = 0; s < n; s++) {
      let acc = 0;
      for (let k = 0; k < oversample; k++) {
        // Zero-stuffed upsampling: the sample, then silence, smoothed by the low-pass (×oversample keeps the level).
        let x = chain(up, k === 0 ? input[s] * this.inputVolts * oversample : 0);
        for (let i = 0; i < circuits.length; i++) {
          // A volume pot after the coupling cap: it scales the swing, not the resting voltage.
          const r = i ? rest[i - 1] : 0;
          x = circuits[i].step(r + (x - r) * gains[i]);
          const swing = Math.abs(x - rest[i]);
          if (swing > peaks[i]) peaks[i] = swing;
        }
        x -= rest[last];
        if (this.power > 0 && !looped) x = Math.tanh((x * this.power) / POWER_VOLTS) * POWER_VOLTS;
        acc = chain(down, x);
      }
      if (looped) {
        let y = acc / LOOP_VOLTS;
        for (const m of loop) y = m.run(y);
        acc = y * LOOP_VOLTS;
        if (this.power > 0) {
          for (let k = 0; k < oversample; k++) {
            const z = chain(up2, k === 0 ? acc * oversample : 0);
            acc = chain(down2, Math.tanh((z * this.power) / POWER_VOLTS) * POWER_VOLTS);
          }
        }
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

  get misses(): number { return this.circuits.reduce((s, c) => s + c.misses, 0) + this.loop.reduce((s, m) => s + m.misses, 0); }
  get iterationsPerStep(): number { return this.circuits.reduce((s, c) => s + c.iterations, 0) / Math.max(1, this.steps); }
}

/** Runs a mono buffer through a rig. Each call starts from the rig's resting state. */
export function runRig(spec: RigSpec, input: Float32Array, sampleRate = 48000, oversample = 4): RigRun {
  const rig = new Rig(spec, sampleRate, oversample);
  const out = new Float32Array(input.length);
  rig.process(input, out);
  return { out, misses: rig.misses, iterationsPerStep: rig.iterationsPerStep };
}
