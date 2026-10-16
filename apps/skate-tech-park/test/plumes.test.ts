// The exhaust, headless: puffs leave a firing nozzle along its bell, swell and die, and the pool never grows.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { roadster } from "@rustybuns/models";
import { Plumes } from "../src/render/plumes.ts";

const car = roadster();
car.group.updateMatrixWorld(true);
const all = (on: (g: string) => boolean) => car.nozzles.map((n) => on(n.group));
const positions = (p: Plumes) => {
  const a = p.puffs.points.geometry.getAttribute("position").array as Float32Array;
  const live: THREE.Vector3[] = [];
  const alpha = p.puffs.points.geometry.getAttribute("aAlpha").array as Float32Array;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > 0) live.push(new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]));
  return live;
};

test("rear thrusters puff out behind the car, and only while firing", () => {
  const p = new Plumes();
  for (let i = 0; i < 30; i++) p.update(1 / 60, car.nozzles, all((g) => g === "rear"), 0, 0, 0);
  const live = positions(p);
  expect(live.length).toBeGreaterThan(40);
  expect(Math.min(...live.map((v) => v.z))).toBeLessThan(-3); // streaming out of the tail
  const before = p.puffs.live;
  for (let i = 0; i < 90; i++) p.update(1 / 60, car.nozzles, all(() => false), 0, 0, 0);
  expect(before).toBeGreaterThan(0);
  expect(p.puffs.live).toBe(0); // all gone once nothing fires
});

test("lift thrusters push down and the pool is a ring that never overflows", () => {
  const p = new Plumes();
  for (let i = 0; i < 600; i++) p.update(1 / 60, car.nozzles, all(() => true), 0, 0, 0);
  expect(p.puffs.live).toBeLessThanOrEqual(1024);
  const q = new Plumes();
  for (let i = 0; i < 20; i++) q.update(1 / 60, car.nozzles, all((g) => g === "lift"), 0, 0, 0);
  expect(Math.min(...positions(q).map((v) => v.y))).toBeLessThan(-0.5);
});

test("a landing kicks up a ring of dust that clears", () => {
  const p = new Plumes();
  p.landed(0, 0, 0, 12);
  expect(p.puffs.live).toBeGreaterThan(10);
  for (let i = 0; i < 90; i++) p.update(1 / 60, [], [], 0, 0, 0);
  expect(p.puffs.live).toBe(0);
});
