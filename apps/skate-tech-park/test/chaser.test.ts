// A chasing animal on a long flat run: it closes on a rider who stops, never catches one on the jets, and a bail while it is near ends the run.
import { expect, test } from "bun:test";
import { chase, chaseOf, GRACE, release } from "../src/chaser.ts";
import { makeLevel } from "../src/level.ts";
import { IDLE, start, step } from "../src/sim.ts";

const level = makeLevel({ name: "flat", pieces: [], rails: [], spawns: [{ name: "car", x: 0, z: 0, yaw: 0 }], bounds: { minX: -50, maxX: 50, minZ: -400, maxZ: 5000 } });
const run = (secs: number, input: Parameters<typeof step>[1]) => {
  const sim = start(0, 0, 0, level), c = release("bear", sim, level.height, level.bounds);
  for (let i = 0; i < secs * 60 && !c.caught; i++) { step(sim, input, level); chase(c, sim, level.height, level.bounds, 1 / 60); }
  return { sim, c };
};

test("a rider who stands still is caught; one on the jets is not", () => {
  expect(run(GRACE + 5, IDLE).c.caught).toBe(true);
  const { sim, c } = run(30, { ...IDLE, throttle: 1, boost: true });
  expect(c.caught).toBe(false);
  expect(Math.hypot(sim.x - c.x, sim.z - c.z)).toBeGreaterThan(100);
});

test("a bail within reach ends the run", () => {
  const sim = start(0, 0, 0, level), c = release("moose", sim, level.height, level.bounds);
  c.x = 0; c.z = -10;
  chase(c, { ...sim, bail: 0 }, level.height, level.bounds, 1 / 60);
  expect(c.caught).toBe(false);
  chase(c, { ...sim, bail: 1 }, level.height, level.bounds, 1 / 60);
  expect(c.caught).toBe(true);
});

test("?chase picks a species", () => {
  expect(chaseOf("?chase=bigfoot")).toBe("bigfoot");
  expect(chaseOf("?chase=dog")).toBeNull();
});
