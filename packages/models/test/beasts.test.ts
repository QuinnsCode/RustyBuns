// Beasts from a parts list: every plan builds, one seed builds one beast, it stands on the ground about one
// unit tall facing +x, wings come as hinged "wing" groups, and it stays inside a triangle budget.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { beast, PLANS, triangles, type Look } from "../src/index.ts";

const look = (plan: Look["plan"], parts: Look["parts"]): Look =>
  ({ plan, parts, build: 1, colors: { hide: "#554433", belly: "#887766", horn: "#ddccbb", eye: "#ff3300" } });
const positions = (o: THREE.Object3D) => {
  const out: number[] = [];
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) out.push(...(c as THREE.Mesh).geometry.attributes.position.array); });
  return out;
};

test.each([
  ["biped", ["snout", "ears", "shaggy", "tail", "hunch"]],
  ["quadruped", ["horns", "spikes", "tail", "hooves"]],
  ["serpent", ["snout", "fins"]],
  ["winged", ["bat-wings", "horns", "forked-tail"]],
  ["swarm", ["bat-wings", "horns"]],
] as const)("%s: one seed builds one beast, feet down, about a unit tall, facing +x", (plan, parts) => {
  const b = beast(look(plan, [...parts]), 3);
  expect(positions(b)).toEqual(positions(beast(look(plan, [...parts]), 3)));
  b.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(b);
  if (plan !== "swarm") expect(Math.abs(box.min.y)).toBeLessThan(0.05);
  expect(box.max.y).toBeGreaterThan(0.8);
  expect(box.max.y).toBeLessThan(1.4);
  // it looks where it goes: the eyes are ahead of the middle
  const eyes = new THREE.Box3();
  b.traverse((o) => { if ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.Material).name === "eye") eyes.expandByObject(o); });
  expect(eyes.getCenter(new THREE.Vector3()).x).toBeGreaterThan(plan === "swarm" ? -0.5 : 0);
  expect(triangles(b)).toBeLessThan(6000);
});

test("wings are their own hinged groups, one each side, and a wingless beast has none", () => {
  const wings = (l: Look) => { const w: THREE.Object3D[] = []; beast(l, 1).traverse((o) => { if (o.name === "wing") w.push(o); }); return w; };
  const w = wings(look("winged", ["feather-wings", "headless"]));
  expect(w.map((o) => Math.sign(o.position.z)).sort()).toEqual([-1, 1]);
  expect(wings(look("quadruped", ["antlers", "ears"]))).toEqual([]);
  expect(PLANS).toHaveLength(5);
});
