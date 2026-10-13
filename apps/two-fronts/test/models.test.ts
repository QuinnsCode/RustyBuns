// The models, headless: every one builds, stands where the sim expects, poses without throwing,
// and stays cheap to draw, since a battle can have forty of them on screen.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { animate, cruiser, fighter, gunship, marine, speeder, tank, turret, walker, wooka } from "../src/battle/models.ts";

const meshes = (g: THREE.Object3D) => {
  let n = 0;
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
  return n;
};
const bounds = (g: THREE.Object3D) => {
  g.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(g);
};

const ground: [string, () => THREE.Group, number][] = [
  ["hero", () => marine(true), 26], ["assault", () => marine(), 26], ["heavy", () => marine(false, "heavy"), 26],
  ["sniper", () => marine(false, "sniper"), 26], ["engineer", () => marine(false, "engineer"), 26],
  ["wooka", () => wooka(), 12], ["chieftain", () => wooka(true), 12],
  ["tank", tank, 8], ["walker", walker, 12], ["speeder", speeder, 8], ["gunship", gunship, 12],
  ["gun tower", () => turret("marines"), 6], ["rock-chucker", () => turret("wooka"), 6],
];

test.each(ground)("%s builds, stands on the ground, and is a handful of draw calls", (_, make, budget) => {
  const g = make();
  expect(meshes(g)).toBeLessThanOrEqual(budget);
  const b = bounds(g);
  if (!["gunship", "speeder"].includes(g.userData.model)) expect(Math.abs(b.min.y)).toBeLessThan(0.15);
  // Each pose is a pose, not an explosion: walking and firing keep the model about its size.
  for (let i = 0; i < 40; i++) animate(g, { t: i / 30, dt: 1 / 30, moved: 0.2, since: (i % 15) / 30 });
  const after = bounds(g);
  expect(after.getSize(new THREE.Vector3()).length()).toBeLessThan(b.getSize(new THREE.Vector3()).length() * 1.6);
});

test("a Marine is about two metres tall, a Wooka knee-high to one, and the chieftain bigger", () => {
  const h = (g: THREE.Object3D) => {
    g.traverse((o) => { if (/^ant\d/.test(o.name)) o.visible = false; });
    let top = 0;
    g.updateMatrixWorld(true);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible && o.parent?.visible !== false && !/^ant/.test(o.parent?.name ?? "")) top = Math.max(top, new THREE.Box3().setFromObject(o).max.y); });
    return top;
  };
  const m = marine(), w = wooka(), c = wooka(true);
  expect(h(m)).toBeGreaterThan(1.9);
  expect(h(m)).toBeLessThan(2.6); // the pack and its dish, antennas aside
  expect(h(w)).toBeLessThan(1.6);
  expect(h(c)).toBeGreaterThan(h(w) * 1.3);
});

test("clones share their geometry, so a horde costs one model's memory", () => {
  const a = wooka(), b = wooka();
  const geo = (g: THREE.Object3D) => { const out: THREE.BufferGeometry[] = []; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push((o as THREE.Mesh).geometry); }); return out; };
  expect(geo(a)).toEqual(geo(b));
  expect(a).not.toBe(b);
});

test("the ships face -z: noses forward, engines behind", () => {
  for (const g of [fighter("marines"), fighter("wooka"), cruiser("marines"), cruiser("wooka")]) {
    const flame = g.getObjectByName("flame")!;
    expect(flame.position.z).toBeGreaterThan(0);
    expect(bounds(g).min.z).toBeLessThan(-flame.position.z * 0.6);
  }
  expect(meshes(cruiser("marines"))).toBeLessThanOrEqual(16);
});
