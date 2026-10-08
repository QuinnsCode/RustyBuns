import { expect, test } from "bun:test";
import { inRing, niceKm, project, ringArea, simplify, type Pt } from "../src/geo.ts";

const square: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];

test("point in ring", () => {
  expect(inRing(5, 5, square)).toBe(true);
  expect(inRing(11, 5, square)).toBe(false);
  expect(ringArea(square)).toBe(100);
});

test("simplify keeps the ends and drops what's within tolerance", () => {
  const line: Pt[] = [[0, 0], [1, 0.01], [2, -0.01], [3, 0], [3, 5]];
  expect(simplify(line, 0.1)).toEqual([[0, 0], [3, 0], [3, 5]]);
});

test("projection: a degree of latitude is ~111 km", () => {
  const [, y] = project(-119, 38.5, -119, 37.5);
  expect(y).toBeCloseTo(111.32, 1);
  const [x] = project(-118, 37.5, -119, 37.5);
  expect(x).toBeCloseTo(111.32 * Math.cos((37.5 * Math.PI) / 180), 1);
});

test("nice numbers for labels", () => {
  expect([0.9, 1.8, 2.6, 4, 8].map(niceKm)).toEqual([1, 2, 2.5, 5, 10]);
});
