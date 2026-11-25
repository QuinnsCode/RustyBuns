// Selling the scale, headless: scenery lands only on open ground and cheaply, the chase camera
// follows a rider down the park from behind and widens with speed.
// The per-park scenery checks are in test/scenery-parks.ts, a part at a time in test/scale-<n>.test.ts.
import { expect, setDefaultTimeout, test } from "bun:test";
import * as THREE from "three";
import { LEVELS } from "../src/levels/index.ts";
import { Chase, FOV } from "../src/render/chase.ts";
import { IDLE, start, step } from "../src/sim.ts";
import { build } from "./parks.ts";

setDefaultTimeout(30_000);

test("the chase camera sits behind and above a rider going down the park, and the view widens with speed", async () => {
  const level = await build(LEVELS[0]!), p = level.spawns[0]!;
  const sim = start(p.x, p.z, p.yaw, level);
  const camera = new THREE.PerspectiveCamera(FOV.base, 1, 0.1, 2000), chase = new Chase(camera);
  chase.snap(sim, "roadster");
  expect(camera.fov).toBe(FOV.base);
  for (let i = 0; i < 180; i++) { // 3 s down the plaza, before the far wall
    step(sim, { ...IDLE, throttle: 1 }, level);
    chase.update(sim, "roadster", 1 / 60);
  }
  const ahead = new THREE.Vector3(Math.sin(sim.yaw), 0, Math.cos(sim.yaw));
  const behind = new THREE.Vector3(sim.x, 0, sim.z).sub(new THREE.Vector3(chase.pos.x, 0, chase.pos.z));
  expect(behind.dot(ahead)).toBeGreaterThan(4); // the camera trails the car
  expect(chase.pos.y).toBeGreaterThan(sim.y + 2);
  expect(camera.fov).toBeGreaterThan(FOV.base + 3);
});
