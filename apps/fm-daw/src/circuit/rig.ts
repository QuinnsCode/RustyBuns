// A guitar rig: circuits in a row (pedals, tube stages, tone stack), run 4×
// oversampled so the clipping's harmonics don't fold back down as fizz, then the
// push-pull power stage (power.ts) and a speaker cabinet's impulse response heard
// through a mic (cab.ts). `Rig` streams block by block (the amp
// page's audio thread runs it); `runRig` does a whole buffer at once.
import { Circuit, type Netlist } from "./mna.ts";
import { Convolver, cabIR, type Mic } from "./cab.ts";
import { butter8, chain, type Biquad } from "./filters.ts";
import { DEFAULT_POWER, PushPull, type Fault, type PowerSpec } from "./power.ts";

/** A link in the rig: a circuit, with an optional volume pot (0 to 1) ahead of it. */
export interface Link { net: Netlist; gain?: number }

export interface RigSpec {
  /** Volts at the input for a full-scale sample: a guitar pickup peaks around 0.1 to 1 V. */
  inputVolts: number;
  links: Link[];
  /** Power-stage drive, the Master (0 for no power amp: a pedal into a desk). */
  power: number;
  /** The output tubes, the supply and what is on the speaker jack (`DEFAULT_POWER` if left out). */
  output?: PowerSpec;
  /** The cabinet, heard through a mic here; null for none (a pedal into a desk). */
  cab: Mic | null;
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

/** About the most volts the power stage puts across the speaker: a pair's ceiling, give or take a quad's extra. */
export const POWER_VOLTS = 40;

/**
 * A rig that streams: `process` a block at a time, and turn its knobs between
 * blocks. `setGain` is a volume pot (free), `setLink` swaps one circuit for
 * another with new part values (one matrix inversion and a rest solve), `setPower`
 * drives the power stage, `setLoad` plugs a speaker in or pulls it out, `setMic`
 * moves the mic on the cab.
 */
export class Rig {
  private circuits: Circuit[];
  private gains: number[];
  /** Each link's resting output voltage. */
  private rest: number[] = [];
  private peaks: Float64Array;
  private up: Biquad[];
  private down: Biquad[];
  private amp: PushPull;
  private cab: Convolver | null;
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
    // Rest state, stage by stage: each one's input is the last one's resting output.
    this.circuits.forEach((c, i) => this.rest.push(c.settle(i ? this.rest[i - 1] : 0)));
    this.peaks = new Float64Array(this.circuits.length);
    this.up = butter8(0.45 * sampleRate, hi);
    this.down = butter8(0.45 * sampleRate, hi);
    this.amp = new PushPull(spec.output ?? DEFAULT_POWER, hi);
    this.cab = spec.cab ? new Convolver(cabIR(spec.cab, sampleRate)) : null;
  }

  /** The volume pot ahead of link `i`, 0 to 1. */
  setGain(i: number, g: number): void { this.gains[i] = g; }
  setPower(p: number): void { this.power = p; }
  /** Ohms on the speaker jack, 0 for nothing plugged in. Play through an open jack and the amp blows (`fault`). */
  setLoad(ohms: number): void { this.amp.setLoad(ohms); }
  /** The mic moves on the cab (and a rig built without a cab gets one). */
  setMic(mic: Mic): void { this.setCab(cabIR(mic, this.sampleRate)); }
  /** A cab's impulse response at the rig's sample rate, measured or made: in place of the mic's. */
  setCab(ir: Float64Array): void { if (this.cab) this.cab.set(ir); else this.cab = new Convolver(ir); }
  setNoise(n: number): void { this.noise = n; for (const c of this.circuits) c.noise = n; }

  /** Link `i` becomes `net` (same input and output roles), starting from its rest state. */
  setLink(i: number, net: Netlist): void {
    const c = new Circuit(net, this.sampleRate * this.oversample);
    c.noise = this.noise;
    this.rest[i] = c.settle(i ? this.rest[i - 1] : 0);
    this.circuits[i] = c;
  }

  /** Mono `n` samples from `input` (full scale ±1) to `output` (volts at the speaker). */
  process(input: Float32Array, output: Float32Array, n = input.length): void {
    const { circuits, gains, rest, peaks, up, down, amp, cab, oversample } = this;
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
        if (this.power > 0) x = amp.step(x, this.power);
        acc = chain(down, x);
      }
      output[s] = cab ? cab.run(acc) : acc;
    }
    this.steps += n * oversample * circuits.length;
  }

  /** Each link's biggest swing (volts) since the last call, then cleared: what lights its tube. */
  levels(): number[] {
    const out = Array.from(this.peaks);
    this.peaks.fill(0);
    return out;
  }

  /** What broke, if something did: `"open-load"` is played through with nothing on the speaker jack. */
  get fault(): Fault | null { return this.amp.fault; }
  /** The power supply now, volts: it sags under a loud chord. */
  get supply(): number { return this.amp.supply; }
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
