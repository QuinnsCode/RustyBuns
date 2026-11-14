// A guitar rig: circuits in a row (pedals, tube stages, tone stack), run 4×
// oversampled so the clipping's harmonics don't fold back down as fizz, then a
// power stage and a speaker-cabinet EQ. Offline for now; the same object is what
// an AudioWorklet or the Rust engine would run per block.
import { Circuit, type Netlist } from "./mna.ts";
import { hardClip, overdrive, toneStack, triodeStage } from "./circuits.ts";

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
}

/** Starting points for each voicing, all built from the same parts. */
export const RIGS = {
  /** Two pedals, no amp: what the pedal sounds like into a clean desk. */
  "hard-clip": { inputVolts: 0.3, links: [{ net: hardClip() }], power: 0, cab: false },
  overdrive: { inputVolts: 0.3, links: [{ net: overdrive(0.6) }], power: 0, cab: false },
  /** Three stages, the second cold-biased and unbypassed, tone stack last: British crunch to lead. */
  brit: {
    inputVolts: 0.3, power: 1.5, cab: true,
    links: [
      { net: triodeStage({ rk: 2.7e3, ck: 0.68e-6 }) },
      { net: triodeStage({ rk: 10e3, ck: 0, cc: 22e-9 }), gain: 0.7 },
      { net: triodeStage({ rk: 820, ck: 0.68e-6, cc: 22e-9 }), gain: 0.5 },
      { net: toneStack({ bass: 5, mid: 7, treble: 6 }) },
    ],
  },
  /** Four stages with small coupling caps and two cold clippers: tight, saturated high gain. */
  "us-high-gain": {
    inputVolts: 0.3, power: 2, cab: true,
    links: [
      { net: triodeStage({ rk: 1.5e3, ck: 0.47e-6, cc: 10e-9 }) },
      { net: triodeStage({ rk: 39e3, ck: 0, cc: 4.7e-9 }), gain: 0.6 },
      { net: triodeStage({ rk: 10e3, ck: 0, cc: 22e-9 }), gain: 0.6 },
      { net: triodeStage({ rk: 1.5e3, ck: 0.47e-6, cc: 22e-9 }), gain: 0.4 },
      { net: toneStack({ bass: 4, mid: 5, treble: 7, slope: 47e3, cTreble: 250e-12 }) },
    ],
  },
  /** Fat bypass caps early and a scooped stack: big, loose, modern. */
  scooped: {
    inputVolts: 0.3, power: 2.5, cab: true,
    links: [
      { net: triodeStage({ rk: 1.8e3, ck: 22e-6 }) },
      { net: triodeStage({ rk: 1.8e3, ck: 1e-6, cc: 22e-9 }), gain: 0.5 },
      { net: triodeStage({ rk: 15e3, ck: 0, cc: 10e-9 }), gain: 0.6 },
      { net: triodeStage({ rk: 1.5e3, ck: 0.68e-6, cc: 22e-9 }), gain: 0.4 },
      { net: toneStack({ bass: 7, mid: 2, treble: 7, cTreble: 500e-12, cBass: 100e-9, cMid: 47e-9 }) },
    ],
  },
} satisfies Record<string, RigSpec>;
export type RigName = keyof typeof RIGS;

export interface RigRun {
  out: Float32Array;
  /** Samples (at the oversampled rate) where a circuit's Newton solve gave up. */
  misses: number;
  /** Average Newton iterations per circuit step. */
  iterationsPerStep: number;
}

/** Runs a mono buffer through a rig. Each call starts from the rig's resting state. */
export function runRig(spec: RigSpec, input: Float32Array, sampleRate = 48000, oversample = 4): RigRun {
  const hi = sampleRate * oversample;
  const circuits = spec.links.map((l) => new Circuit(l.net, hi));
  const gains = spec.links.map((l) => l.gain ?? 1);
  // Rest state, stage by stage: each one's input is the last one's resting output.
  let v = 0;
  circuits.forEach((c, i) => {
    c.settle(v * gains[i]);
    v = c.volts(spec.links[i].net.output);
  });
  const restOut = v;
  const up = butter8(0.45 * sampleRate, hi), down = butter8(0.45 * sampleRate, hi);
  const cab = spec.cab
    ? [Biquad.make("hp", 75, 0.7, sampleRate), Biquad.make("peak", 120, 1, sampleRate, 4), Biquad.make("peak", 1800, 1.2, sampleRate, -3),
       Biquad.make("peak", 3000, 1.2, sampleRate, 3), Biquad.make("lp", 5000, 0.54, sampleRate), Biquad.make("lp", 5000, 1.31, sampleRate)]
    : [];
  const out = new Float32Array(input.length);
  for (let n = 0; n < input.length; n++) {
    let acc = 0;
    for (let k = 0; k < oversample; k++) {
      // Zero-stuffed upsampling: the sample, then silence, smoothed by the low-pass (×oversample keeps the level).
      let x = chain(up, k === 0 ? input[n] * spec.inputVolts * oversample : 0);
      // A volume pot scales the whole voltage, resting level too: the next coupling cap drops the DC.
      for (let i = 0; i < circuits.length; i++) x = circuits[i].step(x * gains[i]);
      x -= restOut;
      if (spec.power > 0) x = Math.tanh((x * spec.power) / 40) * 40;
      acc = chain(down, x);
    }
    out[n] = spec.cab ? chain(cab, acc) : acc;
  }
  const steps = input.length * oversample * circuits.length;
  return {
    out,
    misses: circuits.reduce((s, c) => s + c.misses, 0),
    iterationsPerStep: circuits.reduce((s, c) => s + c.iterations, 0) / steps,
  };
}
