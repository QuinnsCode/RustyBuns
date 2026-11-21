// Profiling, offline: scramble an amp's parts, fit them back from its renders alone.
import { expect, setDefaultTimeout, test } from "bun:test";
import { mulberry32 } from "@rustybuns/util";
import { AMPS } from "../src/circuit/amps.ts";
import { cut, padded } from "../src/circuit/capture.ts";
import { FIT_KNOBS, TONE_PARTS, distance, eValue, features, fit, probe, render, scramble, selfTakes, takesDistance, targetsOf, valuesOf, walkCaps, withValues } from "../src/circuit/fit.ts";

// Each fit is a CMA-ES search over whole renders: the three-take tone stack takes 64 s on the arm Mac runner and
// 121-143 s on the Intel one (#5498), so the limit leaves room for the slowest runner, not the median.
setDefaultTimeout(300_000);

test("parts round to values you can buy, and step along the E24 series", () => {
  for (const [v, steps, want] of [
    [2.7e3, 0, 2.7e3], [2.6e3, 0, 2.7e3], [9.6e3, 0, 10e3], [10e3, -1, 9.1e3], [91, 1, 100], [4.7e-9, 1, 5.1e-9], [0.65e-6, 0, 0.68e-6],
  ] as const) expect(eValue(v, steps)).toBe(want);
});

test("a scrambled amp's cathode resistors and power drive come back from its recording", () => {
  const amp = AMPS.find((a) => a.id === "brit")!;
  const p = probe(24000, true), target = render(amp, p), takes = [{ knobs: FIT_KNOBS(amp), recording: target }];
  const only = ["V1 rk", "V2 rk", "V3 rk", "power"];
  const start = scramble(amp, 7, 2, only);
  const before = distance(features(render(start, p), p), features(target, p));
  const r = fit(start, p, takes, { only, generations: 30, population: 10 });

  const got = Object.fromEntries(r.values.map((v) => [v.name, v.value]));
  const truth = Object.fromEntries(valuesOf(amp).map((v) => [v.name, v.value]));
  expect(valuesOf(start).find((v) => v.name === "V2 rk")?.value).not.toBe(truth["V2 rk"]);
  for (const name of ["V1 rk", "V2 rk", "V3 rk"]) expect(got[name]).toBe(truth[name]);
  expect(got.power).toBeCloseTo(truth.power, 1);
  expect(r.snapped).toBeLessThan(before / 50);
});

test("a take off the interface, late and at any level, lines up and fits like a render", () => {
  const amp = AMPS.find((a) => a.id === "brit")!;
  const p = probe(24000, true), knobs = FIT_KNOBS(amp);
  // The amp plays the padded probe; the interface hands it back 777 samples late, at a quarter of the level, with a little hiss.
  const played = render(amp, { ...p, signal: padded(p) }, knobs);
  const rand = mulberry32(5);
  const recording = new Float32Array(played.length + 777);
  played.forEach((v, i) => { recording[i + 777] = 0.25 * v + 1e-4 * (rand() * 2 - 1); });

  const only = ["V1 rk", "V2 rk", "V3 rk"];
  const start = scramble(amp, 7, 2, only);
  const take = { knobs, recording: cut(recording, render(start, p, knobs)), anyLevel: true };
  const r = fit(start, p, [take], { only, generations: 30, population: 10 });
  const truth = Object.fromEntries(valuesOf(amp).map((v) => [v.name, v.value]));
  for (const v of r.values.filter((v) => only.includes(v.name))) expect(v.value).toBe(truth[v.name]);
});

test("the tone stack's four parts and V1's coupling cap come back from three takes at different tone settings", () => {
  const amp = AMPS.find((a) => a.id === "brit")!;
  const p = probe(24000, true), takes = selfTakes(amp, p);
  const only = TONE_PARTS.filter((n) => n !== "V2 cc");
  const start = scramble(amp, 1, 2, only);
  const truth = Object.fromEntries(valuesOf(amp).map((v) => [v.name, v.value]));
  expect(only.filter((n) => valuesOf(start).find((v) => v.name === n)?.value !== truth[n]).length).toBeGreaterThanOrEqual(3);
  const r = fit(start, p, takes, { only, generations: 16, population: 10, toneGenerations: 0 });
  for (const v of r.values.filter((v) => only.includes(v.name))) expect([v.name, v.value]).toEqual([v.name, truth[v.name]]);
});

test("a fit stuck on a small V1 coupling cap and a large V2 one walks back to both", () => {
  const amp = AMPS.find((a) => a.id === "brit")!;
  const p = probe(24000, true), want = targetsOf(selfTakes(amp, p, []), p);
  const truth = valuesOf(amp).map((v) => v.value);
  const [i, j] = ["V1 cc", "V2 cc"].map((n) => valuesOf(amp).findIndex((v) => v.name === n));
  const stuck = truth.slice();
  stuck[i] = 0.013e-6;
  stuck[j] = 0.068e-6;
  const score = (vals: number[]) => takesDistance(withValues(amp, vals), p, want);
  const r = walkCaps(stuck, score(stuck), i, j, score);
  expect([r.vals[i], r.vals[j]]).toEqual([truth[i], truth[j]]);
});
