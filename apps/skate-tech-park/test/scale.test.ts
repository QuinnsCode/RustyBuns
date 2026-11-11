// Selling the scale, headless: scenery lands only on open ground and cheaply, the chase camera
// follows a rider down the park from behind and widens with speed.
// The per-park scenery checks are in test/scenery-parks.ts, a part at a time in test/scale-<n>.test.ts.
import { expect, setDefaultTimeout, test } from "bun:test";
import * as THREE from "three";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { Chase, FOV } from "../src/render/chase.ts";
import { Scenery, scatter } from "../src/render/scenery.ts";
import { IDLE, start, step } from "../src/sim.ts";
import { build, level as loadLevel } from "./parks.ts";

setDefaultTimeout(60000);

test("a pine shrinks away as the rider nears it, and grows back when they leave", async () => {
  const level = (await loadLevel("mariposa-grove")) as ParkLevel;
  const spots = scatter(level, level.ground), scenery = new Scenery(spots);
  const i = spots.filter((s) => s.kind === "pine").length >> 1, pine = spots.filter((s) => s.kind === "pine")[i]!;
  expect(scenery.scaleOf("pine", i)).toBeCloseTo(1);
  scenery.update([{ x: pine.x + 0.3, z: pine.z }]);
  expect(scenery.scaleOf("pine", i)).toBeLessThan(0.1);
  scenery.update([{ x: pine.x + 40, z: pine.z }]);
  expect(scenery.scaleOf("pine", i)).toBeCloseTo(1);
});

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
