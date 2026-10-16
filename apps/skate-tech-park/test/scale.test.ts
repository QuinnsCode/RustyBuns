// Selling the scale, headless: scenery lands only on open ground and cheaply, the chase camera
// follows a rider down the park from behind and widens with speed, and the sky stays two draw calls of dome and ridges.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { LEVELS } from "../src/levels/index.ts";
import { onRail } from "../src/level.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { Chase, FOV } from "../src/render/chase.ts";
import { DECK } from "../src/models.ts";
import { Scenery, scatter } from "../src/render/scenery.ts";
import { sky } from "../src/render/sky.ts";
import { IDLE, start, step } from "../src/sim.ts";

const parks = LEVELS.filter((e) => "goals" in e.load());

test.each(parks.map((e) => [e.name, e.id]))("%s: scenery is seeded and keeps off pieces, rails and the spawn", (_, id) => {
  const park = LEVELS.find((e) => e.id === id)!.load() as ParkLevel;
  const spots = scatter(park, park.ground);
  expect(spots.length).toBeGreaterThan(50);
  expect(scatter(park, park.ground)).toEqual(spots); // the same every time
  for (const s of spots) {
    expect(park.height(s.x, s.z) - park.ground.height(s.x, s.z)).toBeLessThan(0.03);
    for (const r of park.rails) { const o = onRail(r, s.x, s.z); expect(o.t < -0.05 || o.t > 1.05 || o.off >= 3).toBe(true); }
    for (const sp of park.spawns) expect(Math.hypot(sp.x - s.x, sp.z - s.z)).toBeGreaterThan(11);
  }
  for (const s of spots) expect(s.size).toBeLessThan(DECK.length / 2); // every pine, rock and tent is a toy beside the board
  let calls = 0;
  new Scenery(spots).group.traverse((o) => { if ((o as THREE.Mesh).isMesh) calls++; });
  expect(calls).toBeLessThanOrEqual(7); // one draw call a kind: pines, rocks, aspens, stumps, cairns, signs, tents
  expect(new Set(spots.map((s) => s.kind)).size).toBeGreaterThan(4); // and a park has most of them
});

test("a pine shrinks away as the rider nears it, and grows back when they leave", () => {
  const level = LEVELS.find((e) => e.id === "mariposa-grove")!.load() as ParkLevel;
  const spots = scatter(level, level.ground), scenery = new Scenery(spots);
  const i = spots.filter((s) => s.kind === "pine").length >> 1, pine = spots.filter((s) => s.kind === "pine")[i]!;
  expect(scenery.scaleOf("pine", i)).toBeCloseTo(1);
  scenery.update([{ x: pine.x + 0.3, z: pine.z }]);
  expect(scenery.scaleOf("pine", i)).toBeLessThan(0.1);
  scenery.update([{ x: pine.x + 40, z: pine.z }]);
  expect(scenery.scaleOf("pine", i)).toBeCloseTo(1);
});

test("the chase camera sits behind and above a rider going down the park, and the view widens with speed", () => {
  const level = LEVELS[0]!.load(), p = level.spawns[0]!;
  const sim = start(p.x, p.z, p.yaw, level);
  const camera = new THREE.PerspectiveCamera(FOV.base, 1, 0.1, 2000), chase = new Chase(camera);
  chase.snap(sim, "roadster");
  expect(camera.fov).toBe(FOV.base);
  for (let i = 0; i < 120; i++) { // 2 s down the plaza, before the far wall
    step(sim, { ...IDLE, throttle: 1 }, level);
    chase.update(sim, "roadster", 1 / 60);
  }
  const ahead = new THREE.Vector3(Math.sin(sim.yaw), 0, Math.cos(sim.yaw));
  const behind = new THREE.Vector3(sim.x, 0, sim.z).sub(new THREE.Vector3(chase.pos.x, 0, chase.pos.z));
  expect(behind.dot(ahead)).toBeGreaterThan(4); // the camera trails the car
  expect(chase.pos.y).toBeGreaterThan(sim.y + 2);
  expect(camera.fov).toBeGreaterThan(FOV.base + 3);
});

test("the sky is a dome and two ridge rings", () => {
  let n = 0;
  sky().traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
  expect(n).toBe(3);
});
