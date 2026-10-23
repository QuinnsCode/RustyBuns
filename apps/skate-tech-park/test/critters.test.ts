// The background wildlife, headless: it sits until someone comes near, then runs or flies off and is never caught.
import { expect, test } from "bun:test";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { ALERT, Critters } from "../src/render/critters.ts";
import { level } from "./parks.ts";

const park = (await level("el-capitan")) as ParkLevel;
const make = () => new Critters(park.ground, park.spawns[0]);

test("critters sit still until a threat comes inside their alert distance, then get farther away", () => {
  const c = make();
  c.update(1 / 60, []);
  const sitters = c.all.filter((k) => k.state === "sit" && k.species === "rabbit");
  expect(sitters.length).toBeGreaterThan(0);
  const k = sitters[0]!;
  const threat = { x: k.x + ALERT.rabbit - 2, z: k.z };
  let d = Math.hypot(threat.x - k.x, threat.z - k.z);
  for (let i = 0; i < 60; i++) c.update(1 / 60, [threat]);
  expect(k.state === "flee" || Math.hypot(threat.x - k.x, threat.z - k.z) > d).toBe(true);
  d = Math.hypot(threat.x - k.x, threat.z - k.z);
  expect(d).toBeGreaterThan(ALERT.rabbit - 2);
});

test("a bird flushed by a rider takes to the air, and nothing leaves the park or sinks under the ground", () => {
  const c = make();
  const bird = c.all.find((k) => k.species === "bird" && k.state === "sit")!;
  const threat = { x: bird.x + 3, z: bird.z };
  for (let i = 0; i < 90; i++) c.update(1 / 60, [threat]);
  expect(bird.y - park.ground.height(bird.x, bird.z)).toBeGreaterThan(1);
  for (let i = 0; i < 600; i++) { threat.x += 0.15; c.update(1 / 60, [threat]); }
  for (const k of c.all) {
    expect(Math.hypot(k.x, k.z)).toBeLessThanOrEqual(park.ground.R);
    expect(k.y).toBeGreaterThanOrEqual(park.ground.height(k.x, k.z) - 0.01);
  }
});
