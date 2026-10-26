// The shapes model scripts build with: each faces outwards (its winding encloses a positive volume about the
// size of the solid it stands for), whichever way its rings run, and a part keeps a mesh per material slot.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { R, ball, box, loft, part } from "../src/index.ts";

function volume(geo: THREE.BufferGeometry) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    v += a.dot(b.cross(c)) / 6;
  }
  return v;
}

test.each([
  ["ball", ball("x", 1, [3, 1, -2], { seg: 24, rings: 12 }).geo, (4 / 3) * Math.PI, 0.05],
  ["rings running up", loft("x", [R(0, 1), R(2, 1)], { seg: 32 }).geo, 2 * Math.PI, 0.02],
  ["rings running down", loft("x", [R(2, 1), R(0, 1)], { seg: 32 }).geo, 2 * Math.PI, 0.02],
  ["a cone from a point", loft("x", [R(1, 0, 0), R(0, 1)], { seg: 32 }).geo, Math.PI / 3, 0.02],
  ["a chamfered box", box("x", [2, 1, 1], [0, 0.5, 0], { bevel: 0.1, rot: [0.3, 0.2, 0.1] }).geo, 2, 0.06],
] as const)("%s faces out", (_, geo, expected, tolerance) => {
  expect(Math.abs(volume(geo) - expected) / expected).toBeLessThan(tolerance);
});

test("a part has one mesh per slot, named for it", () => {
  const g = part("hat", [box("felt", [1, 1, 1], [0, 0, 0]), ball("felt", 0.2, [0, 1, 0]), box("band", [1, 0.1, 1], [0, 0, 0])],
    { felt: ["#336699", 0.8, 0], band: ["#222222", 0.5, 0] });
  expect(g.children.map((m) => ((m as THREE.Mesh).material as THREE.Material).name).sort()).toEqual(["band", "felt"]);
});
