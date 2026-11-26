// Q Ladder, the sound wall's transistor ladder low-pass (WALL.md), as a player uses it: Freq and CV move its cutoff
// (a volt an octave with CV up), it passes what is under the cutoff and takes 24 dB an octave off what is over, Res
// makes it ring and, at the top of its turn, sing on its own; and in Q Filter's place in the first voice it plays.
import { expect, setDefaultTimeout, test } from "bun:test";
import { makeSim } from "../src/wall/sims.ts";
import { renderWall, type WallSpec } from "../src/wall/wall.ts";

setDefaultTimeout(30_000);

const SR = 48000;

/** Q Ladder at these knobs, fed `input(i)` on In and `cv` on CV: its out, and its cutoff as it read at the end. */
function ladder(knobs: Record<string, number>, n: number, input: (i: number) => number, cv = 0) {
  const sim = makeSim("ladder", SR, knobs), x = new Float64Array(2), y = new Float64Array(1), out = new Float64Array(n);
  x[1] = cv;
  for (let i = 0; i < n; i++) { x[0] = input(i); sim.step(x, y); out[i] = y[0]; }
  return { out, hz: sim.read().hz };
}
const rms = (x: Float64Array, a = 0, b = x.length) => Math.sqrt(x.subarray(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
/** A 1 V sine at `hz` through it: its out over its in, the last half second. */
const gainAt = (hz: number, knobs: Record<string, number>) => rms(ladder(knobs, SR, (i) => Math.sin((2 * Math.PI * hz * i) / SR)).out, SR / 2) / Math.SQRT1_2;
/** How often the out crosses zero going up between `a` and `b` samples, Hz. */
const crossings = (x: Float64Array, a: number, b: number) => {
  let n = 0;
  for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return (n * SR) / (b - a);
};

test("Freq and CV move Q Ladder's cutoff, and it takes four poles off what is over it", () => {
  // Freq turned up raises the cutoff; with CV all the way up, a volt in is an octave.
  const low = ladder({ freq: 0.3 }, 10, () => 0).hz, mid = ladder({ freq: 0.55 }, 10, () => 0).hz, high = ladder({ freq: 0.8 }, 10, () => 0).hz;
  expect(low).toBeLessThan(mid / 2);
  expect(high).toBeGreaterThan(mid * 2);
  expect(mid).toBeGreaterThan(500);
  expect(mid).toBeLessThan(3000);
  const up = ladder({ cv: 1 }, 10, () => 0, 1).hz / ladder({ cv: 1 }, 10, () => 0, 0).hz;
  expect(up).toBeGreaterThan(1.9);
  expect(up).toBeLessThan(2.1);

  // Under the cutoff it passes the note at about the level it came in; two octaves over, four poles take 40 dB or more.
  const knobs = { res: 0 }, fc = ladder(knobs, 10, () => 0).hz;
  const pass = gainAt(fc / 8, knobs), stop = gainAt(fc * 4, knobs);
  expect(pass).toBeGreaterThan(0.6);
  expect(pass).toBeLessThan(1.6);
  expect(stop / pass).toBeLessThan(0.01);
});

test("Res makes Q Ladder ring at its cutoff, and at the top of its turn it sings on its own", () => {
  // A 1 ms click: with Res down it is gone in a few milliseconds; with Res high it rings on, near the cutoff.
  const click = (i: number) => (i < SR / 1000 ? 1 : 0), n = SR / 5;
  const dry = ladder({ res: 0 }, n, click), wet = ladder({ res: 0.95 }, n, click);
  const tail = (x: Float64Array) => rms(x, SR / 50, SR / 25) / rms(x, 0, SR / 100);
  expect(tail(dry.out)).toBeLessThan(0.01);
  expect(tail(wet.out)).toBeGreaterThan(0.1);
  const ring = crossings(wet.out, SR / 200, SR / 25);
  expect(ring).toBeGreaterThan(wet.hz * 0.7);
  expect(ring).toBeLessThan(wet.hz * 1.3);

  // All the way up, the same click starts it singing: still going strong a second later, at a Eurorack level.
  const sing = ladder({ res: 1 }, SR, click).out;
  expect(rms(sing, SR - SR / 10, SR)).toBeGreaterThan(1);
  expect(rms(sing, SR - SR / 10, SR)).toBeLessThan(8);
});

test("Q Ladder plays the first voice in Q Filter's place, darker as Freq comes down", () => {
  const cable = (a: string, ja: string, b: string, jb: string) => ({ from: [a, ja] as [string, string], to: [b, jb] as [string, string] });
  const voice = (freq: number): WallSpec => ({
    modules: ["seq", "vco", "ladder", "vca", "env", "mix", "out"].map((k): WallSpec["modules"][number] => ({ id: k, kind: k, knobs: k === "mix" ? { "a-1": 0.9 } : k === "ladder" ? { freq } : {} })),
    cables: [
      cable("seq", "cv", "vco", "voct"), cable("vco", "saw", "ladder", "in"), cable("ladder", "out", "vca", "in"),
      cable("seq", "gate", "env", "gate"), cable("env", "out", "vca", "cv"), cable("vca", "out", "mix", "in-1"), cable("mix", "main", "out", "in-l"),
    ],
    returns: [],
  });
  // The voice's edge: the out's sample-to-sample change against its level, which a low-pass takes down.
  const edge = (x: Float32Array) => {
    let d = 0, s = 0;
    for (let i = 1; i < x.length; i++) { d += (x[i] - x[i - 1]) ** 2; s += x[i] ** 2; }
    return { level: Math.sqrt(s / x.length), edge: Math.sqrt(d / s) };
  };
  const open = edge(renderWall(voice(0.75), 1).left), shut = edge(renderWall(voice(0.35), 1).left);
  expect(open.level).toBeGreaterThan(0.01);
  expect(shut.level).toBeGreaterThan(0.002);
  expect(shut.edge).toBeLessThan(open.edge / 2);
});
