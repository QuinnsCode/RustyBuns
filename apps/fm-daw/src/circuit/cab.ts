// The speaker cabinet as an impulse response, and a mic on it. A cab is a
// filter with a shape no handful of EQ bands has (the box's thump, the cone's
// breakup, the back panel's reflection), so the rig convolves an impulse
// response with the amp's output instead. `cabIR` makes one for where the mic
// sits: on the centre cap it is bright and forward, out at the cone's edge it is
// darker and rounder, and turned off axis the top falls away further. A measured
// IR (a WAV someone recorded) goes into the same `Convolver`.
import { clamp, clamp01, lerp } from "@rustybuns/util";
import { Biquad, chain } from "./filters.ts";

export interface Mic {
  /** Where on the cone, 0 the centre cap to 1 the edge of the cone. */
  at: number;
  /** Degrees off axis, 0 (pointing straight at the cone) to 90 (side on). */
  angle: number;
}

export const DEFAULT_MIC: Mic = { at: 0.3, angle: 0 };

/** How long the cab rings, seconds: a closed-back box is quiet after about ten milliseconds. */
export const CAB_SECONDS = 0.012;

/** Gain of an impulse response at `hz` (one DFT bin). */
export function gainAt(ir: Float64Array, hz: number, sr: number): number {
  let re = 0, im = 0;
  for (let k = 0; k < ir.length; k++) { const w = (2 * Math.PI * hz * k) / sr; re += ir[k] * Math.cos(w); im -= ir[k] * Math.sin(w); }
  return Math.hypot(re, im);
}

/** The cabinet heard through a mic at `mic`, as an impulse response at `sampleRate`, unity gain at 800 Hz. */
export function cabIR(mic: Mic, sampleRate: number): Float64Array {
  const at = clamp01(mic.at), off = clamp(mic.angle, 0, 90) / 90;
  const n = Math.round(CAB_SECONDS * sampleRate), sr = sampleRate;
  const top = Math.min(0.45 * sr, lerp(7000, 3200, at) * (1 - 0.45 * off));
  const filters = [
    Biquad.make("hp", 80, 0.7, sr), // the closed box: nothing much below its resonance
    Biquad.make("peak", 110, 1.2, sr, 4), // and a thump at it
    Biquad.make("peak", 1600, 1.5, sr, -3), // the cone's dip before it breaks up
    Biquad.make("peak", lerp(3600, 2000, at), 1.4, sr, lerp(5, 1, at) - 3 * off), // breakup: bright at the cap, softer out at the edge
    Biquad.make("lp", top, 0.54, sr), Biquad.make("lp", top, 1.31, sr),
  ];
  // What reaches the mic: the cone, the back panel's reflection through the cone a moment later,
  // and out at the edge, the surround's own echo off the cone's rim.
  const back = Math.round(0.0007 * sr), rim = Math.max(1, Math.round(0.00012 * at * sr));
  const ir = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const x = (k === 0 ? 1 : 0) + (k === back ? -0.25 : 0) + (k === rim ? 0.3 * at : 0);
    ir[k] = chain(filters, x);
  }
  // Fade the last quarter so the cut doesn't click.
  const fade = Math.floor(n / 4);
  for (let k = n - fade; k < n; k++) ir[k] *= 0.5 + 0.5 * Math.cos((Math.PI * (k - (n - fade))) / fade);
  const g = gainAt(ir, 800, sr);
  for (let k = 0; k < n; k++) ir[k] /= g;
  return ir;
}

/**
 * Direct convolution, one sample at a time. The history is kept twice over so
 * each output is one straight run through memory; a 12 ms IR at 48 kHz is 576
 * multiply-adds a sample. native/crates/fm_daw/src/circuit.rs `Convolver` is this.
 */
export class Convolver {
  private buf: Float64Array;
  private at = 0;
  constructor(private ir: Float64Array) { this.buf = new Float64Array(2 * ir.length); }

  /** A new response; the history carries over when it is the same length (a mic moving). */
  set(ir: Float64Array): void {
    if (ir.length !== this.ir.length) { this.buf = new Float64Array(2 * ir.length); this.at = 0; }
    this.ir = ir;
  }

  run(x: number): number {
    const { ir, buf } = this, n = ir.length;
    if (!n) return x;
    this.at = (this.at === 0 ? n : this.at) - 1;
    const at = this.at;
    buf[at] = x; buf[at + n] = x;
    let y = 0;
    for (let k = 0; k < n; k++) y += ir[k] * buf[at + k];
    return y;
  }
}
