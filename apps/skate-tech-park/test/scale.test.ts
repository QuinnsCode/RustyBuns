// Selling the scale, headless: scenery lands only on open ground and cheaply, the chase camera
// follows a rider down the park from behind and widens with speed, and the sky stays two draw calls of dome and ridges.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { LEVELS } from "../src/levels/index.ts";
import { onRail } from "../src/level.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { Chase, FOV } from "../src/render/chase.ts";
import { DECK } from "../src/models.ts";
import { Scenery, TREES, scatter } from "../src/render/scenery.ts";
import { sky } from "../src/render/sky.ts";
import { IDLE, start, step } from "../src/sim.ts";
import { build, level as loadLevel } from "./parks.ts";

const parks = LEVELS.filter((e) => e.id !== "plaza");

test.each(parks.map((e) => [e.name, e.id]))("%s: scenery is seeded and keeps off pieces, rails and the spawn", async (_, id) => {
  const park = (await loadLevel(id)) as ParkLevel;
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
  expect(calls).toBeLessThanOrEqual(10); // one draw call a kind the park grows: pines, rocks, aspens, stumps, cairns, signs, tents, bushes, ferns, flowers
  expect(new Set(spots.map((s) => s.kind)).size).toBeGreaterThan(4); // and a park has most of them
});

test.each(parks.map((e) => [e.name, e.id]))("%s: the kit stands in a clearing and the forest thickens past it", async (_, id) => {
  const park = (await loadLevel(id)) as ParkLevel;
  const spots = scatter(park, park.ground), trees = spots.filter((s) => TREES.has(s.kind));
  const dist = (s: { x: number; z: number }) => Math.min(...park.pieces.map((p) => Math.hypot(p.x - s.x, p.z - s.z) - Math.hypot(p.w, p.d) / 2));
  expect(trees.length).toBeGreaterThan(100);
  expect(trees.filter((s) => dist(s) < 5).length).toBe(0); // nothing tall crowds the kit
  expect(spots.filter((s) => s.kind === "flower" || s.kind === "fern" || s.kind === "sage").length).toBeGreaterThan(20); // the clearing has meadow in it
  expect(trees.filter((s) => dist(s) > 25).length).toBeGreaterThan(trees.filter((s) => dist(s) < 15).length * 0.5); // and the woods are further out (the kit now spreads over the whole map, so the clearing is the 12 m around each part, not a 40 m belt)
});

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

test("the sky is a dome and four ridge rings", () => {
  let n = 0;
  sky().traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
  expect(n).toBe(5);
});
