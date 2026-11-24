// Qollab Studio's keys seat: each of the three families stands on the floor within the width asked, has 61 keys from
// C, and puts its white keys' tops and near edge where the seat's reach expects them, cheap to draw.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { POLY_KEY_FRONT, POLY_KINDS, polysynth } from "../src/polysynth.ts";
import { triangles } from "../src/index.ts";

test.each([...POLY_KINDS])("the %s stands on the floor, inside its width, its 61 keys where a seated player reaches", (kind) => {
  const keyTop = 0.842, s = polysynth(7, { fit: 1.2, keyTop, kind });
  const box = new THREE.Box3().setFromObject(s.group);
  expect(s.kind).toBe(kind);
  expect(Math.abs(box.min.y)).toBeLessThan(0.005);
  expect(box.max.x - box.min.x).toBeLessThanOrEqual(1.2 + 1e-6);
  expect(s.keys.whiteAt.length + s.keys.blackAt.length).toBe(61);
  // a white key is 22 mm tall: its top at keyTop, its near edge at POLY_KEY_FRONT
  for (const [, y, z] of s.keys.whiteAt) {
    expect(y + 0.011).toBeCloseTo(keyTop, 4);
    expect(z + s.keys.whiteLen / 2).toBeCloseTo(POLY_KEY_FRONT, 4);
  }
  expect(triangles(s.group)).toBeLessThan(20000);
});
