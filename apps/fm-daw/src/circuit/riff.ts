// A dry guitar riff to play through the rigs when no guitar is plugged in:
// plucked strings (Karplus-Strong), seeded so it sounds the same every time.
import { mulberry32 } from "@rustybuns/util";

/** A plucked string: a burst of filtered noise circulating in a delay line that loses a little each pass. */
function pluck(out: Float32Array, sr: number, rand: () => number, at: number, hz: number, seconds: number, muted: boolean, amp: number) {
  const len = sr / hz, n = Math.floor(len), frac = len - n;
  const line = new Float32Array(n + 2);
  let lp = 0;
  for (let i = 0; i < line.length; i++) { lp += 0.6 * (rand() * 2 - 1 - lp); line[i] = lp; }
  const loss = muted ? 0.93 : 0.997, end = Math.min(out.length, at + Math.floor(seconds * sr));
  let p = 0, prev = 0;
  for (let t = at; t < end; t++) {
    const a = line[p], b = line[(p + 1) % line.length];
    const y = a + frac * (b - a);
    line[p] = loss * 0.5 * (y + prev);
    prev = y;
    p = (p + 1) % n;
    const fade = Math.min(1, (end - t) / (sr / 100)); // let go without a click
    out[t] += amp * y * fade;
  }
}

/** Two bars at 140: palm-muted chugs, power chords, then a held lead line up high. Peaks at 0.8. */
export function riff(sr = 48000): Float32Array<ArrayBuffer> {
  const rand = mulberry32(7);
  const e = 60 / 140 / 2, out = new Float32Array(Math.round(sr * e * 22));
  const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  const at = (eighths: number) => Math.round(eighths * e * sr);
  const chord = (when: number, root: number, beats: number) => [0, 7, 12].forEach((s) => pluck(out, sr, rand, at(when), hz(root + s), beats * e, false, 0.5));
  for (let i = 0; i < 6; i++) pluck(out, sr, rand, at(i), hz(40), e, true, 0.8);
  chord(6, 40, 2);
  chord(8, 43, 1); chord(9, 45, 1); chord(10, 40, 2);
  [59, 62, 64].forEach((m, i) => pluck(out, sr, rand, at(12 + i), hz(m), i === 2 ? 8 * e : e, false, 0.6));
  let pk = 0;
  for (const v of out) pk = Math.max(pk, Math.abs(v));
  return out.map((v) => (v / pk) * 0.8);
}
