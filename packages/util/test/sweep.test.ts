import { expect, test } from "bun:test";
import { cheese, CHEESE, loopShot, sweepShot } from "../src/index.ts";

const focus = { x: 10, y: 5, z: -20 };
const dist = (s: { from: { x: number; z: number } }) => Math.hypot(s.from.x - focus.x, s.from.z - focus.z);

test("a sweep closes in and cranes down on its subject, then hands the view back", () => {
  const first = sweepShot(0, focus), mid = sweepShot(4, focus), last = sweepShot(8, focus);
  expect(dist(first)).toBeGreaterThan(dist(mid));
  expect(dist(mid)).toBeGreaterThan(dist(last));
  expect(first.from.y).toBeGreaterThan(last.from.y);
  expect([first.mix, mid.mix, last.mix]).toEqual([1, 1, 0]);
  // Past the end it stays put rather than flying on.
  expect(sweepShot(99, focus)).toEqual(last);
});

test("a looping backdrop stays near its subject and loops", () => {
  for (const t of [0, 17, 61, 119]) expect(dist(loopShot(t, focus))).toBeGreaterThan(20);
  const a = loopShot(5, focus), b = loopShot(125, focus);
  expect(b.from.x).toBeCloseTo(a.from.x);
  expect(b.from.z).toBeCloseTo(a.from.z);
});

test("a narrator's line is picked by number, whatever the number", () => {
  expect(cheese("skate", 0)).toBe(CHEESE.skate[0]);
  expect(cheese("hide", 5)).toBe(CHEESE.hide[1]);
  expect(cheese("recon", -1)).toBe(CHEESE.recon[3]);
});
