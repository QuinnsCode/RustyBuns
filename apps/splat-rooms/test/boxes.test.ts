// Box maths is what makes objects clickable.
import { test, expect } from "bun:test";
import { toObb, rayObb } from "../src/viewer/boxes.ts";

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
  [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
    .map(([x, y, z]) => ({ x, y, z }));

test("an axis-aligned box gives back its own centre and size", () => {
  const o = toObb(box(0, 0, 0, 2, 4, 6))!;
  expect(o.center).toEqual([1, 2, 3]);
  expect(o.size).toEqual([2, 4, 6]);
  expect(o.volume).toBe(48);
});

test("a ray hits a box in front and misses one behind or beside", () => {
  const o = toObb(box(1, -1, -1, 2, 1, 1))!;
  expect(rayObb([0, 0, 0], [1, 0, 0], o)).toBeCloseTo(1, 5);
  expect(rayObb([0, 0, 0], [-1, 0, 0], o)).toBeNull();
  expect(rayObb([0, 5, 0], [1, 0, 0], o)).toBeNull();
});

test("a flat box (a painting on a wall) is still clickable", () => {
  const o = toObb(box(1, -0.5, 0, 1.0, 0.5, 1))!;   // zero thickness in x
  expect(o.size[0]).toBe(0);
  expect(rayObb([0, 0, 0.5], [1, 0, 0], o)).toBeCloseTo(0.99, 2);
});

