import { describe, expect, test } from "bun:test";
import { carryKm, hangTime, levelFor, powerFor, simulateThrow, syntheticWind } from "../src/flight.ts";
import { bearing, destination, distanceKm } from "../src/geo.ts";
import type { WindLevel } from "../src/grib2.ts";

const steady = (u: number, v: number): WindLevel => {
  const grid = { ni: 360, nj: 181, la1: 90, lo1: 0, di: 1, dj: 1 };
  return { grid, level: "10 m above ground", u: new Float32Array(360 * 181).fill(u), v: new Float32Array(360 * 181).fill(v) };
};
const tee = { lat: 48.85, lon: 2.35 }; // Paris

describe("a throw", () => {
  test("a putt is possible: the slider goes down to a short carry", () => {
    expect(carryKm(0.5)).toBeLessThan(300);
    expect(powerFor(300)).toBe(0.5);
    expect(powerFor(4600)).toBe(10);
    expect(powerFor(1500)).toBe(3.5);
  });
  test("in still air lands where the great circle says, and the heading holds", () => {
    for (const heading of [0, 90, 237]) {
      const f = simulateThrow({ from: tee, heading, power: 7, loft: "low" }, null);
      const want = destination(tee, heading, carryKm(7));
      expect(distanceKm(f.landing, want)).toBeLessThan(5);
      expect(f.windDriftKm).toBeLessThan(5);
      expect(f.path.length).toBeGreaterThan(50);
    }
  });
  test.each([
    ["an east wind", 8, 0, 90],
    ["a north wind", 0, 8, 0],
    ["a wind from the south-west", -6, -6, 225],
  ])("%s pushes the disc that way", (_n, u, v, towards) => {
    const f = simulateThrow({ from: tee, heading: 180, power: 5, loft: "low" }, steady(u, v));
    expect(f.windDriftKm).toBeGreaterThan(200);
    const pushed = bearing(f.stillAir, f.landing);
    expect(Math.abs(((pushed - towards + 540) % 360) - 180)).toBeLessThan(25);
    expect(f.maxWind).toBeCloseTo(Math.hypot(u, v), 3);
  });
  test("a lofted throw hangs longer and rides the jet", () => {
    const levels = syntheticWind(3);
    expect(levelFor(levels, "high")!.level).toBe("250 mb");
    expect(levelFor(levels, "low")!.level).toBe("10 m above ground");
    expect(levelFor([], "low")).toBeNull();
    expect(hangTime(6, "high")).toBeGreaterThan(hangTime(6, "low"));
    const athens = { lat: 37.98, lon: 23.73 }; // under the synthetic jet's core
    const low = simulateThrow({ from: athens, heading: 90, power: 6, loft: "low" }, levelFor(levels, "low"));
    const high = simulateThrow({ from: athens, heading: 90, power: 6, loft: "high" }, levelFor(levels, "high"));
    expect(high.maxWind).toBeGreaterThan(low.maxWind);
    expect(high.windDriftKm).toBeGreaterThan(low.windDriftKm);
  });
});
