// The roadster, headless: ten nozzles where the sim expects them, the plate over the main one, and few draw calls.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { roadster, roadsterLook } from "../src/index.ts";

const meshes = (g: THREE.Object3D) => {
  let n = 0;
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
  return n;
};

test("ten nozzles in four groups, pointing the way their group fires", () => {
  const car = roadster();
  const by = (g: string) => car.nozzles.filter((n) => n.group === g);
  expect(car.nozzles).toHaveLength(10);
  expect([by("rear").length, by("lift").length, by("spinL").length, by("spinR").length]).toEqual([4, 4, 1, 1]);
  expect(by("rear").filter((n) => n.main)).toHaveLength(1);
  car.group.updateMatrixWorld(true);
  const exhaust = (o: THREE.Object3D) => new THREE.Vector3(0, 1, 0).transformDirection(o.parent!.matrixWorld);
  for (const n of by("rear")) expect(exhaust(n.mount).z).toBeCloseTo(-1);
  for (const n of by("lift")) expect(exhaust(n.mount).y).toBeCloseTo(-1);
  expect(exhaust(by("spinL")[0].mount).x).toBeCloseTo(-1);
  expect(exhaust(by("spinR")[0].mount).x).toBeCloseTo(1);
});

test("the plate covers the main nozzle and swings clear of it", () => {
  const car = roadster();
  const main = car.nozzles.find((n) => n.main)!;
  const at = (o: THREE.Object3D) => { car.group.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
  const mouth = main.mount.getWorldPosition(new THREE.Vector3());
  const hidden = at(car.plate);
  expect(hidden.min.x).toBeLessThan(mouth.x);
  expect(hidden.max.x).toBeGreaterThan(mouth.x);
  expect(hidden.min.y).toBeLessThan(mouth.y);
  expect(hidden.max.y).toBeGreaterThan(mouth.y);
  expect(hidden.min.z).toBeLessThan(mouth.z); // behind the mouth
  car.plate.rotation.x = -Math.PI * 0.95;
  expect(at(car.plate).max.y).toBeLessThan(mouth.y);
});

test("a handful of draw calls, nose toward +z, sitting on its wheels", () => {
  const car = roadster(roadsterLook());
  expect(meshes(car.group)).toBeLessThanOrEqual(45);
  const b = new THREE.Box3().setFromObject(car.group);
  expect(Math.abs(b.min.y)).toBeLessThan(0.1);
  expect(b.getSize(new THREE.Vector3()).z).toBeGreaterThan(4);
  expect(car.wheels).toHaveLength(4);
});
