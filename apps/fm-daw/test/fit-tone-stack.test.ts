// Profiling, offline: the tone stack fit back from three renders at different tone settings. The slowest fit, in a file
// of its own so a CI lane can run it beside fit.test.ts's (#5922).
import { expect, setDefaultTimeout, test } from "bun:test";
import { AMPS } from "../src/circuit/amps.ts";
import { TONE_PARTS, fit, probe, scramble, selfTakes, valuesOf } from "../src/circuit/fit.ts";

// a CMA-ES search over whole renders: 64 s on the arm Mac runner and 121-143 s on the Intel one (#5498)
setDefaultTimeout(300_000); // the three-take tone stack fit, 121-143 s on the Intel runner

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
