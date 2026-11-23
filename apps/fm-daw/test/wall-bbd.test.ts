// Q Brigade, the sound wall's bucket-brigade delay (WALL.md), as a player patches it: a key's note from Q Keys through
// Q Saw, Q Swell and Q Level into it, and out of Q Out. The echo comes back where the Time knob says, as loud as the
// note went in; Repeats brings more of them; Mod sweeps the delay as a chorus does; Time CV lengthens it.
import { expect, setDefaultTimeout, test } from "bun:test";
import { Wall } from "../src/wall/wall.ts";

setDefaultTimeout(60_000);

const SR = 48000;
const cable = (a: string, ja: string, b: string, jb: string) => ({ from: [a, ja] as [string, string], to: [b, jb] as [string, string] });

/** A 30 ms note through Q Brigade at these knobs: Q Out's left side for `seconds`, and the delay it read as it began. */
function echo(knobs: Record<string, number>, seconds = 0.5, cv: [string, string] | null = null) {
  const wall = new Wall(SR);
  wall.set({
    modules: [
      { id: "keys", kind: "keys", knobs: {} }, { id: "vco", kind: "vco", knobs: {} }, { id: "env", kind: "env", knobs: { attack: 0, release: 0 } },
      { id: "vca", kind: "vca", knobs: { level: 0, cv: 1 } }, { id: "bbd", kind: "bbd", knobs: { mod: 0, repeats: 0, mix: 1, ...knobs } },
      { id: "out", kind: "out", knobs: {} }, { id: "lfo", kind: "lfo", knobs: {} },
    ],
    cables: [
      cable("keys", "pitch", "vco", "voct"), cable("keys", "gate", "env", "gate"), cable("vco", "saw", "vca", "in"), cable("env", "out", "vca", "cv"),
      cable("vca", "out", "bbd", "in"), cable("bbd", "out", "out", "in-l"),
      ...(cv ? [cable(cv[0], cv[1], "bbd", "cv")] : []),
    ],
    returns: [],
  });
  const n = Math.round(seconds * SR), left = new Float32Array(n), l = new Float32Array(128), r = new Float32Array(128);
  let ms = NaN;
  const delays: number[] = [];
  wall.note(48, 1);
  for (let at = 0; at < n; at += 128) {
    if (at >= 0.03 * SR && at < 0.03 * SR + 128) wall.note(48, 0);
    wall.process(l, r, 128);
    left.set(l.subarray(0, Math.min(128, n - at)), at);
    const read = wall.state().find((m) => m.id === "bbd")?.read ?? {};
    if (at === 0) ms = read.ms;
    delays.push(read.ms);
  }
  return { left, ms, delays };
}
/** The rms of `x` from `a` to `b` seconds. */
const rmsIn = (x: Float32Array, a: number, b: number) => {
  const s = x.subarray(Math.round(a * SR), Math.round(b * SR));
  return Math.sqrt(s.reduce((t, v) => t + v * v, 0) / s.length);
};
/** When the output first passes a tenth of its peak, seconds. */
const onset = (x: Float32Array) => {
  const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  return x.findIndex((v) => Math.abs(v) > peak / 10) / SR;
};

test("a note through Q Brigade comes back at the Time knob's delay, with Repeats and Mod and Time CV doing what they say", () => {
  // Time across its turn, all wet: nothing until the delay, then the note. Turned up, the delay is longer.
  const near = echo({ time: 0.2 }), far = echo({ time: 0.8 });
  expect(near.ms).toBeGreaterThan(15);
  expect(far.ms).toBeGreaterThan(near.ms + 40);
  for (const e of [near, far]) {
    expect(onset(e.left)).toBeGreaterThan(e.ms / 1000 - 0.002);
    expect(onset(e.left)).toBeLessThan(e.ms / 1000 + 0.01);
  }
  // As loud as the note went in: Mix fully dry is the note, fully wet its echo, within 3 dB (a short note comes back
  // a little under, the expander's averaging catching up with its start).
  const dry = echo({ time: 0.5, mix: 0 }), wet = echo({ time: 0.5 });
  const loud = (x: Float32Array) => rmsIn(x, 0, x.length / SR);
  expect(loud(wet.left) / loud(dry.left)).toBeGreaterThan(0.7);
  expect(loud(wet.left) / loud(dry.left)).toBeLessThan(1.41);

  // Repeats up: the echo comes round again, so three delays on it is several times louder than the note's own tail
  // (Q Swell's release, carried a delay late) is without it.
  const once = echo({ time: 0.6 }, 1), again = echo({ time: 0.6, repeats: 0.8 }, 1), d = once.ms / 1000;
  expect(rmsIn(again.left, 3 * d, 3 * d + 0.03)).toBeGreaterThan(4 * rmsIn(once.left, 3 * d, 3 * d + 0.03));

  // Mod sweeps the delay with the board's own LFO; with it down the delay holds.
  const still = echo({ time: 0.5 }, 1).delays, swept = echo({ time: 0.5, mod: 0.6, rate: 0.9 }, 1).delays;
  expect(Math.max(...still) - Math.min(...still)).toBeLessThan(0.01);
  expect(Math.max(...swept) - Math.min(...swept)).toBeGreaterThan(5);

  // Time CV: Q Wobble's square, cabled in, moves it.
  const cv = echo({ time: 0.5 }, 1, ["lfo", "sqr"]).delays;
  expect(Math.max(...cv) - Math.min(...cv)).toBeGreaterThan(5);
});
