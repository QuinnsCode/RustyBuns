// The QDJ decks' arithmetic on what a DJ does with it: master tempo holds a tone's pitch while the tempo moves, a
// turntable brake and motor start cover the ground a real platter does, a loop's out point is stretched and shortened
// by the jog, the tempo buttons pick the narrowest range that reaches, and the Qone mixer's LFO waves start on the
// beat in every shape. The page side (worklet, buttons) runs in headless Chrome: test/dj-decks-page.test.ts.
import { expect, test } from "bun:test";
import { rangeFor } from "../src/dj/analyze.ts";
import { lfoTerms, lfoValue, LFO_SHAPES, softClip } from "../src/dj/mixer.ts";
import { adjustLoop, MIN_LOOP_S, rampS, speedAt, travel } from "../src/dj/player.ts";
import { Stretch } from "../src/dj/stretch.ts";

const RATE = 48000;
/** Rising zero crossings a second in `x`: a tone's frequency. */
const hzOf = (x: Float32Array) => { let n = 0; for (let i = 1; i < x.length; i++) if (x[i - 1]! < 0 && x[i]! >= 0) n++; return n / (x.length / RATE); };

test("master tempo: a 440 Hz tone played 8% fast stays at 440 Hz, and keeps up with where the deck is", () => {
  const tone = Float32Array.from({ length: RATE * 4 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE));
  const read = (_c: number, s: number) => { const i = Math.floor(s * RATE); return i >= 0 && i < tone.length - 1 ? tone[i]! + (tone[i + 1]! - tone[i]!) * (s * RATE - i) : 0; };
  for (const speed of [1.08, 0.9, 1.5]) {
    const st = new Stretch(1, RATE, RATE), one = new Float32Array(1), out = new Float32Array(RATE * 2);
    for (let i = 0; i < out.length; i++) { st.next(one, read, (k) => ((i + k) / RATE) * speed); out[i] = one[0]!; }
    const steady = out.subarray(RATE / 4);
    expect(Math.abs(hzOf(steady) - 440)).toBeLessThan(3);
    // the frames overlap into a steady level, not a wobble: loudness within a few per cent across the run
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    const parts = [0, 1, 2, 3].map((q) => rms(steady.subarray((q * steady.length) / 4, ((q + 1) * steady.length) / 4)));
    for (const p of parts) expect(Math.abs(p / (0.5 / Math.SQRT2) - 1)).toBeLessThan(0.08);
  }
});

test("the brake and the motor start: a deck coasts to a stop over the brake, and comes up to speed over the start", () => {
  const brake = { from: 10, at: 0, r0: 1, r1: 0, T: 2 };
  expect(speedAt(brake, 1)).toBeCloseTo(0.5, 9);
  expect(speedAt(brake, 3)).toBe(0);
  expect(travel(brake, 2)).toBeCloseTo(1, 9); // half the ground of playing on at full speed
  expect(travel(brake, 5)).toBeCloseTo(1, 9); // and stays put once it's stopped
  const start = { from: 0, at: 0, r0: 0, r1: 1.08, T: 0.5 };
  expect(travel(start, 0.5)).toBeCloseTo(0.27, 9);
  expect(travel(start, 1.5)).toBeCloseTo(0.27 + 1.08, 9);
  expect(travel({ from: 0, at: 0, r0: 1, r1: 1, T: 0 }, 3)).toBe(3); // steady: no ramp at all
  // the knobs: 0 is instant (a CD player), the top is the longest, finer at the short end
  expect([rampS(0, 4), rampS(0.5, 4), rampS(1, 4)]).toEqual([0, 1, 4]);
});

test("LOOP OUT, then OUT again: the jog clockwise makes the loop longer, back makes it shorter, never past the track or under a sliver", () => {
  const loop = { start: 10, end: 12 };
  expect(adjustLoop(loop, "out", 0.5, 300)).toEqual({ start: 10, end: 12.5 });
  expect(adjustLoop(loop, "out", -0.5, 300)).toEqual({ start: 10, end: 11.5 });
  expect(adjustLoop(loop, "out", -5, 300).end).toBeCloseTo(10 + MIN_LOOP_S, 9);
  expect(adjustLoop(loop, "out", 400, 300).end).toBe(300);
  expect(adjustLoop(loop, "in", -1, 300)).toEqual({ start: 9, end: 12 });
});

test("the tempo buttons: 6 to 100 per cent, sync takes the narrowest that reaches", () => {
  expect([3, 6.5, 9, 11, 14, 20, 40, 70, 120].map(rangeFor)).toEqual([6, 8, 10, 12, 15, 25, 50, 100, 100]);
});

test("the LFO's waves: every shape, started at any point of its round, is the shape from that point", () => {
  for (const shape of LFO_SHAPES) for (const phase of [0, 0.25, 0.6]) {
    const { real, imag } = lfoTerms(shape, phase);
    const at = (t: number) => { let v = 0; for (let k = 1; k < real.length; k++) v += real[k]! * Math.cos(2 * Math.PI * k * t) + imag[k]! * Math.sin(2 * Math.PI * k * t); return v; };
    // away from a square's or ramp's jump, the series is the shape (a little rounded at its corners)
    for (const t of [0.1, 0.2, 0.3]) {
      const p = phase + t, edge = [0, 0.5, 1].some((e) => Math.abs((p % 1) - e) < 0.08);
      if (!edge) expect(Math.abs(at(t) - lfoValue(shape, p))).toBeLessThan(shape === "sine" ? 1e-6 : 0.12);
    }
  }
});

test("the filter's soft clip: untouched below 0.8, a resonant peak bent under full scale", () => {
  expect([0.1, -0.5, 0.8].map(softClip)).toEqual([0.1, -0.5, 0.8]);
  for (const x of [1, 2, 4, -4]) expect(Math.abs(softClip(x))).toBeLessThan(1);
});
