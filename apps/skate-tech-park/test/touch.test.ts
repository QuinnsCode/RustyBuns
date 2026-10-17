import { expect, test } from "bun:test";
import { STICK_RADIUS, stickAxes } from "../src/touch.ts";

test("the stick reads a push as steer and throttle, and ignores a resting thumb", () => {
  expect(stickAxes(0, 0)).toEqual({ steer: 0, throttle: 0 });
  expect(stickAxes(3, -4)).toEqual({ steer: 0, throttle: 0 });
  const up = stickAxes(0, -STICK_RADIUS);
  expect(up.throttle).toBe(1);
  expect(stickAxes(0, 500).throttle).toBe(-1); // past the rim is still a full push
  expect(stickAxes(-STICK_RADIUS, 0).steer).toBe(1); // left is positive steer, as A is
  expect(stickAxes(STICK_RADIUS, 0).steer).toBe(-1);
});
