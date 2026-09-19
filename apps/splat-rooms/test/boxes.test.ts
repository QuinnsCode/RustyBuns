// Box maths is what makes objects clickable, and it is pure, so it gets tested
// against the real InteriorGS labels rather than made-up boxes.
import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { toObb, rayObb, type Vec3 } from "../src/viewer/boxes.ts";

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

test("the nearest hit along a ray is the smaller distance", () => {
  const near = toObb(box(1, -1, -1, 2, 1, 1))!;
  const far = toObb(box(5, -1, -1, 6, 1, 1))!;
  expect(rayObb([0, 0, 0], [1, 0, 0], near)!).toBeLessThan(rayObb([0, 0, 0], [1, 0, 0], far)!);
});

const scene = join(homedir(), "Documents", "SplatRooms", "0001_839920", "labels.json");
test("every boxed object in a real scene converts, and a ray through the room hits something", () => {
  if (!existsSync(scene)) { console.log("  (skipped: no scene in ~/Documents/SplatRooms)"); return; }
  const objs = JSON.parse(readFileSync(scene, "utf8")) as { label: string; bounding_box?: { x: number; y: number; z: number }[] }[];
  const boxed = objs.filter((o) => o.bounding_box);
  const obbs = boxed.map((o) => toObb(o.bounding_box!));
  expect(obbs.every(Boolean)).toBe(true);
  // Sweep a ray across the room at eye height and count hits.
  let hits = 0;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const dir: Vec3 = [Math.cos(a), Math.sin(a), 0];
    if (obbs.some((o) => rayObb([1, -3, 1.4], dir, o!) !== null)) hits++;
  }
  console.log(`  ${boxed.length} boxes, ${hits}/24 sweep directions hit something`);
  expect(hits).toBeGreaterThan(8);
});
