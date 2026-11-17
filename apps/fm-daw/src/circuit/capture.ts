// Capture: the probe played out of an audio interface into a real amp, and what
// comes back lined up so `fit` can score it. The interface, the reamp box and
// the load box or mic all add a delay nobody knows, and the return level is
// wherever the input gain sat; this finds the one and lets the fit ignore the
// other. Playing and recording are `scripts/capture-amp.ts` (ANALOG.md section 6, #4943).
import { Fft } from "../engine/linear.ts";
import type { Probe } from "./fit.ts";

/** Silence before and after the probe in a take, so a late interface and a ringing cab both fit. */
export const PAD_SECONDS = 0.5;

/** The probe with `PAD_SECONDS` of silence either side: what plays out of the interface. */
export function padded(p: Probe): Float32Array {
  const pad = Math.round(p.sampleRate * PAD_SECONDS);
  const out = new Float32Array(p.signal.length + 2 * pad);
  out.set(p.signal, pad);
  return out;
}

/**
 * How many samples into `recording` the `reference` starts: the peak of their
 * cross-correlation, worked out with one FFT each. Pass a render of the closest
 * amp as the reference, not the bare probe, and the amp's own delay (its
 * filters, the cab) cancels: only the interface's is left.
 */
export function align(recording: Float32Array, reference: Float32Array): number {
  let n = 1;
  while (n < recording.length + reference.length) n <<= 1;
  const fft = new Fft(n);
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(recording); br.set(reference);
  fft.run(ar, ai); fft.run(br, bi);
  // recording × conj(reference), back to time: entry k is the match at lag k.
  for (let i = 0; i < n; i++) { const r = ar[i] * br[i] + ai[i] * bi[i], im = ai[i] * br[i] - ar[i] * bi[i]; ar[i] = r; ai[i] = im; }
  fft.run(ar, ai, true);
  let best = 0;
  for (let k = 1; k <= recording.length - reference.length; k++) if (ar[k] > ar[best]) best = k;
  return best;
}

/** The stretch of `recording` that lines up with `reference` (a render of the probe), the same length. */
export function cut(recording: Float32Array, reference: Float32Array): Float32Array {
  const at = align(recording, reference);
  const out = new Float32Array(reference.length);
  out.set(recording.subarray(at, at + reference.length));
  return out;
}
