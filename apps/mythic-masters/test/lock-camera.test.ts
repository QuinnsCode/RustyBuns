import { expect, test } from "bun:test";
import { lockCamera, lockGap } from "../src/lock-camera.ts";
import { body, ROSTER } from "../src/roster.ts";

const of = (id: string) => body(ROSTER.find((c) => c.id === id)!);

// The camera players fight in: at the gaps a fight spends its time in, your own fighter no longer covers the other
// one (round 17's judges both saw the near body hide the target). Toe to toe the camera rises instead.
test.each([
  ["rougarou", "black-shuck"],
  ["red-dragon", "champ"],
  ["jersey-devil", "wampus-cat"],
])("%s never hides %s from the lock camera", (a, b) => {
  const A = of(a), B = of(b), me = { x: 0, y: 0, z: 0 };
  for (const d of [2, 3, 5]) {
    const them = { x: d, y: 0, z: 0 }, back = 1.4 + A.radius * 1.2 + d * 0.4;
    expect(lockGap(lockCamera(me, them, back, 1, A.radius, B.radius), me, them, A.radius * 1.2, B.radius * 0.5)).toBeGreaterThanOrEqual(0);
  }
  const close = lockCamera(me, { x: 1, y: 0, z: 0 }, 3, 1, A.radius, B.radius);
  expect(close.y).toBeGreaterThan(1);
  // far apart it stays the plain over-the-shoulder shot, a little off the line
  const far = lockCamera(me, { x: 12, y: 0, z: 0 }, 6, 1, A.radius, B.radius);
  expect(far).toMatchObject({ x: expect.closeTo(-6 * Math.cos(0.5), 5), y: 1, z: expect.closeTo(-6 * Math.sin(0.5), 5) });
});
