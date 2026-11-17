// Profiling, offline: scramble an amp's gain staging, fit it back from a render alone.
import { expect, setDefaultTimeout, test } from "bun:test";
import { AMPS } from "../src/circuit/amps.ts";
import { distance, eValue, features, fit, probe, render, scramble, valuesOf } from "../src/circuit/fit.ts";

setDefaultTimeout(120_000);

test("parts round to values you can buy, and step along the E24 series", () => {
  for (const [v, steps, want] of [
    [2.7e3, 0, 2.7e3], [2.6e3, 0, 2.7e3], [9.6e3, 0, 10e3], [10e3, -1, 9.1e3], [91, 1, 100], [4.7e-9, 1, 5.1e-9], [0.65e-6, 0, 0.68e-6],
  ] as const) expect(eValue(v, steps)).toBe(want);
});

test("a scrambled amp's cathode resistors and power drive come back from its recording", () => {
  const amp = AMPS.find((a) => a.id === "brit")!;
  const p = probe(24000, true), target = render(amp, p);
  const only = ["V1 rk", "V2 rk", "V3 rk", "power"];
  const start = scramble(amp, 7, 2, only);
  const before = distance(features(render(start, p), p), features(target, p));
  const r = fit(start, p, target, { only, generations: 30, population: 10 });

  const got = Object.fromEntries(r.values.map((v) => [v.name, v.value]));
  const truth = Object.fromEntries(valuesOf(amp).map((v) => [v.name, v.value]));
  expect(valuesOf(start).find((v) => v.name === "V2 rk")?.value).not.toBe(truth["V2 rk"]);
  for (const name of ["V1 rk", "V2 rk", "V3 rk"]) expect(got[name]).toBe(truth[name]);
  expect(got.power).toBeCloseTo(truth.power, 1);
  expect(r.snapped).toBeLessThan(before / 50);
});
