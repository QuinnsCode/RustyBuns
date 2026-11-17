// Outdoor sound against numbers worked by hand or read off the standards' own tables.
import { expect, test } from "bun:test";
import { airAbsorption, barrierLoss, bendAngle, echoOf, pressureAt, reflection, source, speedOfSound, weatherAtDistance } from "../src/index.ts";

test("air absorption matches ISO 9613-2's table at 10 C and 70% humidity, and dry thin air takes more of the highs", () => {
  // dB/km, ISO 9613-2:1996 Table 2.
  for (const [hz, dbKm] of [[500, 1.9], [1000, 3.7], [2000, 9.7], [4000, 32.8], [8000, 117]]) {
    expect(Math.abs(airAbsorption(hz, 10, 70) * 1000 / dbKm - 1)).toBeLessThan(0.06);
  }
  // 100 m at 8 kHz: about 11 dB in damp air, more than twice that in the dry evening at 1,950 m.
  expect(airAbsorption(8000, 20, 50) * 100).toBeCloseTo(10.5, 0);
  expect(airAbsorption(8000, 17, 22, pressureAt(1950)) * 100).toBeGreaterThan(20);
});

test("speed of sound, pressure, barrier, weather and bending, worked by hand", () => {
  const cases: [string, number, number, number][] = [
    // name, got, want, digits
    ["c at 20 C", speedOfSound(20), 343.2, 1],
    ["c at 30 C", speedOfSound(30), 349.0, 1],
    ["kPa at 1,950 m", pressureAt(1950), 80.4, 1],
    // Maekawa at grazing (N = 0): 10 log10 3.
    ["barrier grazing", barrierLoss(0, 1000), 4.77, 2],
    // 1 m extra at 1 kHz: N = 5.83, 10 log10(3 + 116.6).
    ["barrier 1 m at 1 kHz", barrierLoss(1, 1000), 20, 1],
    // Downwind under an inversion at 1.5 km: capped at +5.
    ["weather downwind night", weatherAtDistance(1500, 2, true), 5, 1],
    // Upwind on a lapse at 1 km: 1.5 × -3 - 2 = -6.5.
    ["weather upwind day", weatherAtDistance(1000, -3, false), -6.5, 1],
    ["weather near", weatherAtDistance(100, 5, true), 0, 1],
  ];
  for (const [, got, want, digits] of cases) expect(got).toBeCloseTo(want, digits);
  // A tailwind bends the beam down, a headwind lifts it; 100 m in a 3 m/s breeze is well under a degree.
  expect(bendAngle(100, 3, 0)).toBeGreaterThan(0);
  expect(bendAngle(100, -3, 0)).toBeLessThan(0);
  expect(Math.abs((bendAngle(100, 3, 0) * 180) / Math.PI)).toBeLessThan(1);
});

test("a wall's reflection by the image source, and when a late arrival is an echo", () => {
  // A wall at x = -10 facing +x; the speaker at the origin, the listener 20 m down the line.
  const wall = { at: { x: -10, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, z0: -100, z1: 100, top: 50 };
  const sub = source("sub-18", { x: 0, y: 1, z: 0 });
  const r = reflection(sub, wall, { x: 0, y: 1, z: 20 }, 0)!;
  // The image at x = -20: the path is √(20² + 20²).
  expect(r.path).toBeCloseTo(28.28, 2);
  // Level at 1 m less 20 log10(28.28) = 29 dB, and the sub's own 360-degree pattern: the bounce is 45 degrees off its
  // axis, 6 × (45 / 180)² = 0.375 dB down.
  expect(r.level).toBeCloseTo(99 + 10 * Math.log10(800) - 20 * Math.log10(28.28) - 0.375, 2);
  // Behind the wall, nothing comes back.
  expect(reflection(sub, wall, { x: -12, y: 1, z: 20 })).toBeNull();
  // 60 ms late and 5 dB down is an echo; 30 ms late is fused with the first.
  expect(echoOf([{ db: 100, ms: 0 }, { db: 95, ms: 60 }])).toEqual({ db: -5, ms: 60 });
  expect(echoOf([{ db: 100, ms: 0 }, { db: 98, ms: 30 }])).toBeNull();
});
