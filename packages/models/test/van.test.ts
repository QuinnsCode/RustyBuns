// The camper van parked round an open-air floor: on its wheels, the size it says, the awning out to its side.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { VAN_SIZE, van } from "../src/van.ts";

test("a van stands on its wheels inside its size, and its awning rolls out to the side it's on", () => {
  const plain = new THREE.Box3().setFromObject(van(1)), out = new THREE.Box3().setFromObject(van(1, { awning: true }));
  expect(plain.min.y).toBeCloseTo(0, 2);
  expect(plain.max.x - plain.min.x).toBeLessThan(VAN_SIZE.w + 0.1);
  expect(plain.max.z - plain.min.z).toBeLessThan(VAN_SIZE.d + 0.2);
  expect(plain.max.y).toBeLessThan(VAN_SIZE.h + 0.4); // the rack and its load on the roof
  expect(out.max.x).toBeGreaterThan(plain.max.x + 2.5); // the awning and its guy ropes, out over the sand
});
