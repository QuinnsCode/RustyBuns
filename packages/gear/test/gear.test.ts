// Textbook numbers the gear math has to hit, then a dive-bar setup run through it the way Load In will.
import { expect, test } from "bun:test";
import {
  CIRCUIT_15A,
  CIRCUIT_20A,
  GEAR_IDS,
  ampWatts,
  cableLoss,
  circuitLoad,
  coverage,
  gear,
  generatorLoad,
  jackNames,
  levelAt,
  ohmsPerMetre,
  parallel,
  runHours,
  series,
  source,
  splAt,
  sumCoherent,
  sumPower,
  type Gear,
} from "../src/index.ts";

const top = source("top-12-powered", { x: 0, y: 1.6, z: 0 });
const at = (x: number, z: number) => ({ x, y: 1.6, z });
const heater = (w: number): Gear => ({ id: "load", what: "test load", size: { w: 0, h: 0, d: 0 }, kg: 0, jacks: {}, draw: { idle: w, loud: w } });
const rack = gear("amp-rack-4u").amp!;
const sens = top.speaker.sensitivity;

const cases: [string, number, number, number][] = [
  ["1 W at 1 m is the sensitivity", splAt({ ...top, watts: 1 }, at(0, 1)), sens, 0.01],
  ["double the distance, -6 dB", splAt(top, at(0, 8)) - splAt(top, at(0, 4)), -6.02, 0.01],
  ["double the watts, +3 dB", splAt({ ...top, watts: 200 }, at(0, 4)) - splAt({ ...top, watts: 100 }, at(0, 4)), 3.01, 0.01],
  ["coverage edge (45 deg on a 90 deg box), -6 dB", splAt({ ...top, watts: 1 }, at(Math.SQRT1_2, Math.SQRT1_2)), sens - 6, 0.01],
  ["never past max SPL", splAt({ ...top, watts: 1e6 }, at(0, 1)), top.speaker.maxSpl, 0.01],
  ["two sources by power, +3 dB", sumPower([100, 100]), 103.01, 0.01],
  ["two sources in phase, +6 dB", sumCoherent([{ db: 100, phase: 0 }, { db: 100, phase: 0 }]), 106.02, 0.01],
  ["8 ohm parallel 8 ohm is 4", parallel(8, 8), 4, 1e-9],
  ["8 ohm series 8 ohm is 16", series(8, 8), 16, 1e-9],
  ["rack channel into 4 ohms", ampWatts(rack, parallel(8, 8)).watts, 1000, 1e-9],
  ["rack channel into 16 ohms", ampWatts(rack, 16).watts, 325, 1e-9],
  ["12 AWG is about 5.2 milliohm a metre", ohmsPerMetre(12) * 1000, 5.21, 0.02],
  ["30 m of 12 AWG into 8 ohms loses a third of a dB", cableLoss(12, 30, 8), 0.33, 0.01],
  ["30 m of 16 AWG into 4 ohms loses about 1.6 dB", cableLoss(16, 30, 4), 1.57, 0.02],
  ["a 15 A breaker carries 1800 W", circuitLoad([heater(1800)], CIRCUIT_15A).limit, 1800, 1e-9],
  ["a 7 kVA generator runs 6300 W", generatorLoad("generator-7kva", []).limit, 6300, 1e-9],
  ["a full tank at the full 6.3 kW lasts about 9 hours", runHours("generator-7kva", 6300, 25), 8.91, 0.01],
  ["at 350 W, 4 litres lasts under 6 hours", runHours("generator-7kva", 350, 4), 5.54, 0.01],
];

test.each(cases)("%s", (_name, got, want, tol) => {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);
});

test("over the rating trips, and a load below the amp's minimum is a problem", () => {
  expect(circuitLoad([heater(1800)], CIRCUIT_15A).trips).toBe(false);
  expect(circuitLoad([heater(1801)], CIRCUIT_15A).trips).toBe(true);
  expect(circuitLoad([heater(1801)], CIRCUIT_20A).trips).toBe(false);
  expect(ampWatts(rack, parallel(8, 8, 8, 8, 8)).problem).toContain("below");
  expect(ampWatts(gear("amp-head").amp!, parallel(8, 8, 8)).problem).toContain("4 ohm minimum");
});

test("the catalog has every shared id with its size, and jacks number from 1", () => {
  expect(GEAR_IDS).toEqual([
    "top-12-powered", "top-15-passive", "sub-18", "wedge-12", "amp-head", "cab-4x12", "amp-rack-4u", "mixer-small",
    "generator-7kva", "distro-box", "cable-ramp-2ch", "road-case-m", "stand-tripod", "mic-stand", "di-box", "line-array-box", "guitar", "line-array-10", "fill-8-powered", "jerry-can-20l", "bar-cooler",
  ]);
  expect(gear("sub-18")).toMatchObject({ size: { w: 0.55, h: 0.7, d: 0.75 }, kg: 45 });
  expect(jackNames(gear("generator-7kva"))).toEqual(["power-out-1", "power-out-2", "power-out-3", "power-out-4"]);
  expect(() => gear("fog-machine")).toThrow("no gear fog-machine");
});

test("a dive bar: two tops and two subs on one 15 A circuit, a power alley down the middle", () => {
  const subL = source("sub-18", { x: -3, y: 0.35, z: 0 });
  const subR = source("sub-18", { x: 3, y: 0.35, z: 0 });
  const tops = [source("top-12-powered", { x: -3, y: 1.9, z: 0 }, { yaw: 0.3 }), source("top-12-powered", { x: 3, y: 1.9, z: 0 }, { yaw: -0.3 })];
  const sources = [subL, subR, ...tops];
  const area = { x0: -6, z0: 1, x1: 6, z1: 13, y: 1.6, nx: 64, nz: 64 };

  // Down the middle both subs arrive together: +6 dB over one. Off the middle they fall in and out of phase.
  const one = levelAt([subL], at(0, 8), "low");
  expect(levelAt([subL, subR], at(0, 8), "low") - one).toBeCloseTo(6.02, 1);
  const low = coverage(sources, area, "low");
  expect(Math.max(...low.db) - Math.min(...low.db)).toBeGreaterThan(20);

  // Mids and highs add as power, so no deep holes; the tops play "high" and the subs stay out of it.
  const high = coverage(sources, area, "high");
  expect(levelAt(sources, at(0, 8), "high")).toBeCloseTo(levelAt(tops, at(0, 8), "high"), 6);
  const front = high.db[10 * 64 + 32];
  expect(front).toBeGreaterThan(95);
  expect(front).toBeLessThan(115);

  // Powered tops and a mixer at show level fit a 15 A circuit; add the amp rack and it trips.
  const plugged = ["top-12-powered", "top-12-powered", "mixer-small"];
  expect(circuitLoad(plugged, CIRCUIT_15A).trips).toBe(false);
  expect(circuitLoad([...plugged, "amp-rack-4u"], CIRCUIT_15A).trips).toBe(true);
});

test("a 64 x 64 grid of four sources is well under 5 ms", () => {
  const sources = [-3, -1, 1, 3].map((x) => source("top-12-powered", { x, y: 1.9, z: 0 }));
  const area = { x0: -8, z0: 0.5, x1: 8, z1: 16, y: 1.6, nx: 64, nz: 64 };
  for (let i = 0; i < 5; i++) coverage(sources, area, "high");
  const times: number[] = [];
  for (let i = 0; i < 9; i++) {
    const t = performance.now();
    coverage(sources, area, "low");
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  expect(times[4]).toBeLessThan(5);
});
