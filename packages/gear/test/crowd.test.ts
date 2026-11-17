// The three things a crowd does to a sound system, with numbers worked by hand: bodies in the line take the highs and
// leave the bass, a full room rings shorter (Sabine), and the crowd is loud on its own.
import { expect, test } from "bun:test";
import { crowdLoss, crowdNoise, fillFloor, headcount, reverbTime } from "../src/index.ts";

const floor = { x0: -10, x1: 10, z0: 0, z1: 20, nx: 20, nz: 20 };
const even = (rho: number) => ({ ...floor, density: new Float32Array(400).fill(rho) });

test.each([
  // 10 m at ear height (1.5 m, under the heads) through a packed crowd (4 per m2): the BODY_LOSS rate times 10 m.
  ["packed, 4 kHz", 4, 1.5, 4000, 11],
  ["packed, 2 kHz", 4, 1.5, 2000, 9],
  ["packed, 125 Hz: bass goes round bodies", 4, 1.5, 125, 0.2],
  ["half as dense is half the loss", 2, 1.5, 4000, 5.5],
  ["over the heads (2.5 m, past 1.75 + 0.25 clear)", 4, 2.5, 4000, 0],
  ["half a step into the clearance (1.875 m) is half the loss", 4, 1.875, 4000, 5.5],
])("crowd loss: %s", (_, rho, y, hz, db) => {
  expect(crowdLoss(even(rho), { x: 0, y, z: 2 }, { x: 0, y, z: 12 }, hz)).toBeCloseTo(db, 5);
});

test.each([
  // 5 x 12 x 2.7 m bar at alpha 0.12: V = 162 m3, S = 211.8 m2, A = 25.416 m2, RT = 0.161 V / A.
  ["empty bar", 0, 1000, 1.0262],
  // 90 people at 0.47 m2 each at 1 kHz add 42.3 m2: A = 67.716 m2.
  ["90 in, mids", 90, 1000, 0.3852],
  // At 125 Hz each person is only 0.18 m2 (16.2 m2): A = 41.616 m2, so the bass still rings.
  ["90 in, bass", 90, 125, 0.6267],
])("reverb time: %s", (_, people, hz, rt) => {
  expect(reverbTime({ w: 5, d: 12, h: 2.7, alpha: 0.12 }, people, hz)).toBeCloseTo(rt, 3);
});

test.each([
  [2, 45],
  [40, 85],
  [80, 88],
  [160, 91],
  [2000, 95],
])("crowd noise with %d people is %d dB", (people, db) => {
  expect(crowdNoise(people)).toBeCloseTo(db, 5);
});

test("a crowd packs against the stage and thins to the back; too many for the floor fill it at the packed density", () => {
  const f = fillFloor(floor, 300, 0);
  expect(headcount(f)).toBeCloseTo(300, 0);
  expect(f.density[10]!).toBeCloseTo(4, 5);
  expect(f.density[19 * 20 + 10]!).toBeLessThan(0.5);
  expect(headcount(fillFloor(floor, 5000, 0))).toBeCloseTo(4 * 400, 0);
});
