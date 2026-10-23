import { expect, test } from "bun:test";
import { stickAxes } from "../src/index.ts";

test("a thumb stick reads centred in the dead zone, full at the rim and no further", () => {
  expect(stickAxes(0, 0, 50)).toEqual({ x: 0, y: 0 });
  expect(stickAxes(3, -4, 50)).toEqual({ x: 0, y: 0 });
  expect(stickAxes(50, 0, 50)).toEqual({ x: 1, y: 0 });
  expect(stickAxes(0, -500, 50).y).toBe(-1);
  // Past the rim the direction is kept: a diagonal push stays a diagonal.
  const d = stickAxes(300, 300, 50);
  expect(d.x).toBeCloseTo(d.y);
  expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
  expect(stickAxes(25, 0, 50, 0.6)).toEqual({ x: 0, y: 0 });
});
