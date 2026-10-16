import { expect, test } from "bun:test";
import { between } from "../src/render/interp.ts";

test("a frame between two steps draws between them, and turns the short way round", () => {
  const mid = between({ x: 0, y: 0, z: 0, yaw: Math.PI - 0.1 }, { x: 1, y: 0.5, z: 1, yaw: -Math.PI + 0.1 }, 0.5);
  expect(mid).toMatchObject({ x: 0.5, y: 0.25, z: 0.5 });
  expect(Math.cos(mid.yaw)).toBeCloseTo(-1, 5); // through pi, not back across zero
});

test("a reset is not smeared across the frame", () => {
  expect(between({ x: 0, y: 0, z: 0, yaw: 0 }, { x: 40, y: 0, z: 0, yaw: 1 }, 0.5)).toEqual({ x: 40, y: 0, z: 0, yaw: 1 });
});
