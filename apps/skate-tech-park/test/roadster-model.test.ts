// The modelled roadster (scripts/roadster.ts) at each polygon budget: it takes the shared body's place at the
// same footprint, on its wheels, and keeps all ten nozzles and the plate, so the plumes still fire from it.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { dressRoadster, ROADSTER_BUDGETS, roadster, type Thruster } from "../src/models.ts";

const glb = (budget: string) => Bun.file(new URL(`../public/models/roadster-${budget}.glb`, import.meta.url)).arrayBuffer();

test.each([...ROADSTER_BUDGETS])("the %s roadster stands where the shared one did and keeps its thrusters", async (budget) => {
  const before = new THREE.Box3().setFromObject(roadster()).getSize(new THREE.Vector3());
  const car = roadster();
  expect(await dressRoadster(car, await glb(budget))).toBe(true);
  const box = new THREE.Box3().setFromObject(car), size = box.getSize(new THREE.Vector3());
  expect(box.min.y).toBeCloseTo(0, 1); // on its tyres
  for (const k of ["x", "y", "z"] as const) expect(Math.abs(size[k] - before[k])).toBeLessThan(0.35);
  const thrusters = car.userData.thrusters as Thruster[];
  expect(thrusters).toHaveLength(10);
  for (const t of thrusters) {
    let o: THREE.Object3D | null = t.mount;
    while (o && o !== car) o = o.parent;
    expect(o).toBe(car); // still on the car, so the plumes follow it
  }
  expect(car.children).toContain(car.userData.plate);
});
