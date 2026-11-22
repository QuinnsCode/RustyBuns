// Two short dance tracks made in code, for the decks with nothing loaded yet and for the tests: a four-to-the-floor
// kick, an open hat on the off-beat, a bass line and a stab every other bar, at the tempo asked for, starting after
// `lead` seconds of near silence so the first downbeat isn't at zero. Mono, plain samples, no Web Audio.
import { mulberry32 } from "@rustybuns/util";

export interface Demo { name: string; bpm: number; lead: number }
export const DEMOS: Demo[] = [{ name: "Night drive (124)", bpm: 124, lead: 0.35 }, { name: "Dune runner (128)", bpm: 128, lead: 0.2 }];

/** `seconds` of the track at `rate`: its samples, -1 to 1. */
export function demoTrack(d: Demo, rate: number, seconds = 60): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate)), beat = 60 / d.bpm, rnd = mulberry32(d.bpm);
  const add = (at: number, len: number, f: (t: number) => number) => {
    const a = Math.round(at * rate), n = Math.round(len * rate);
    for (let i = 0; i < n && a + i < out.length; i++) out[a + i]! += f(i / rate);
  };
  const roots = [55, 55, 65.41, 49] as const;
  for (let b = 0; d.lead + b * beat < seconds; b++) {
    const t0 = d.lead + b * beat, bar = Math.floor(b / 4);
    // the kick: a sine falling from 120 Hz to 48, with a click on its front
    add(t0, 0.35, (t) => Math.sin(2 * Math.PI * (48 * t + (72 / 30) * (1 - Math.exp(-30 * t)))) * Math.exp(-t * 9) * 0.9);
    // the open hat on the off-beat
    add(t0 + beat / 2, 0.09, (t) => (rnd() * 2 - 1) * Math.exp(-t * 45) * 0.18);
    // the bass: a rolling sixteenth line on the bar's root, ducked under the kick
    const root = roots[bar % roots.length]!;
    for (let s = 1; s < 4; s++) add(t0 + (s * beat) / 4, beat / 4.5, (t) => Math.sign(Math.sin(2 * Math.PI * root * t)) * 0.12 * Math.exp(-t * 10));
    // a chord stab on the and-of-two, every other bar
    if (b % 8 === 1) add(t0 + beat / 2, 0.25, (t) => (Math.sin(2 * Math.PI * root * 4 * t) + Math.sin(2 * Math.PI * root * 5 * t) + Math.sin(2 * Math.PI * root * 6 * t)) * 0.06 * Math.exp(-t * 8));
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i]!);
  return out;
}
