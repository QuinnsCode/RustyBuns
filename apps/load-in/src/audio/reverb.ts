// The room you hear: an impulse response for the page's convolver, noise that dies away 60 dB over the room's reverb
// time (`roomWith` in crowd/crowd.ts, Sabine), the mids at `rt60` and the bass at `rt60Low`. An empty bar rings for a
// second; ninety people in it and it tightens to under half that. Plain numbers: play.ts loads them into a buffer.
import { clamp, mulberry32 } from "@rustybuns/util";

/** Under this reverb time the room adds nothing you would hear, s: out of doors, or a room packed with soft things. */
export const DRY = 0.05;

/** -60 dB in amplitude is e^-6.91: a decay of e^(-6.91 t / rt60) reaches it at t = rt60. */
const LN_1000 = Math.log(1000);

/**
 * Two channels (left and right, from different seeds so the wash sits round you) of decaying noise, `rt60` long plus a
 * little tail: the noise run through a one-pole low-pass at about 250 Hz carries the bass and dies over `rt60Low`, the
 * rest carries the mids over `rt60`. The convolver normalises its loudness.
 */
export function impulse(rt60: number, rt60Low: number, rate: number): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const long = Math.max(rt60, rt60Low), n = Math.max(1, Math.round(rate * Math.min(4, long * 1.1)));
  const a = Math.exp((-2 * Math.PI * 250) / rate);
  return [1, 2].map((seed) => {
    const out = new Float32Array(n), rnd = mulberry32(5062 + seed);
    let low = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate, white = rnd() * 2 - 1;
      low = a * low + (1 - a) * white;
      out[i] = ((white - low) * Math.exp((-LN_1000 * t) / rt60) + low * 3 * Math.exp((-LN_1000 * t) / rt60Low));
    }
    return out;
  }) as [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];
}

/** How much of the room you hear against the speakers, 0 to 0.5: a longer reverb is more of the sound you get. */
export const wetOf = (rt60: number) => (rt60 < DRY ? 0 : clamp((0.5 * rt60) / (rt60 + 0.6), 0, 0.5));
