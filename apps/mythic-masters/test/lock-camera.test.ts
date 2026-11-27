import { expect, test } from "bun:test";
import { lockCamera, lockGap, SIDE_TURN, sideTurn } from "../src/lock-camera.ts";
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
  const low = lockCamera(me, { x: 12, y: 0, z: 0 }, A, B).y;
  for (const d of [2, 3, 5]) {
    const them = { x: d, y: 0, z: 0 };
    expect(lockGap(lockCamera(me, them, A, B), me, them, A.radius * 1.2, B.radius * 0.5)).toBeGreaterThanOrEqual(0);
  }
  expect(lockCamera(me, { x: 1, y: 0, z: 0 }, A, B).y).toBeGreaterThan(low);
  // far apart it stays the plain over-the-shoulder shot, half a radian off the line
  const far = lockCamera(me, { x: 12, y: 0, z: 0 }, A, B);
  expect(Math.atan2(-far.z, -far.x)).toBeCloseTo(0.5, 5);
});

// The side camera turns round two close bodies slowly (a skirmisher exchange whipped it through four angles in a second,
// #6042 round 13), faster as they part, never more than SIDE_TURN.lag behind the line, and the short way round past ±π.
const mid = (SIDE_TURN.near + SIDE_TURN.apart) / 2;
test.each([
  ["close, a small turn", 0, 0.3, 2, 1 / 60, SIDE_TURN.close / 60],
  ["parting, a small turn", 0, 0.3, mid, 1 / 60, (SIDE_TURN.close + SIDE_TURN.far) / 2 / 60],
  ["close, a big turn", 0, 3, 2, 1 / 60, 3 - SIDE_TURN.lag],
  ["across ±π", 3, -3, 2, 1, -3],
])("%s", (_, line, want, d, dt, at) => {
  const got = sideTurn(line, want, d, dt);
  expect(Math.abs(Math.atan2(Math.sin(got - at), Math.cos(got - at)))).toBeLessThan(1e-6);
});
