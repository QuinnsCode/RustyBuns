// Plants from a seed: same seed, same plant; feet on the ground; faces turned outwards (a wrong winding shows
// the inside to the light and culls the outside); and a shrub about the size the park hides campers in.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { barrel, pear, saguaro, shrub } from "../src/index.ts";

/** Volume from the triangles' winding: positive when they face out. */
function volume(geo: THREE.BufferGeometry) {
  const p = geo.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    v += a.dot(b.cross(c)) / 6;
  }
  return v;
}

test.each([
  ["shrub", (s: number) => shrub(s), 1.2, 1.6],
  ["berried shrub", (s: number) => shrub(s, { berries: true }), 1.2, 1.6],
  ["saguaro", saguaro, 5.5, 8],
  ["barrel", barrel, 0.6, 1],
  ["pear", pear, 0.8, 2],
] as const)("%s: one seed grows one plant, standing on the ground, faces out", (_, grow, lo, hi) => {
  const geo = grow(7);
  expect(geo.attributes.position.array).toEqual(grow(7).attributes.position.array);
  expect(geo.attributes.position.array).not.toEqual(grow(8).attributes.position.array);
  expect(geo.attributes.color.count).toBe(geo.attributes.position.count);
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  expect(Math.abs(box.min.y)).toBeLessThan(0.05);
  expect(box.max.y).toBeGreaterThan(lo);
  expect(box.max.y).toBeLessThan(hi);
  expect(volume(geo)).toBeGreaterThan(0);
});

test("a shrub covers the spot a camper crouches in (1.1 sizes from its middle) and no more than half again", () => {
  for (const geo of [shrub(1), shrub(2, { wide: 1.25 })]) {
    geo.computeBoundingBox();
    const { min, max } = geo.boundingBox!;
    const reach = Math.max(max.x, -min.x, max.z, -min.z);
    expect(reach).toBeGreaterThan(0.9);
    expect(reach).toBeLessThan(1.5);
  }
});
