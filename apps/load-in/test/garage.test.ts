// The garage load-in as a player does it: walk out to the cab at the door, lift it (slow), carry it to the amp by the
// outlet, set it down, then stack the amp head on top. The same calls the page's `window.loadIn` harness makes.
import { expect, test } from "bun:test";
import { WALK, carrySpeed, newWorld, pickUp, putDown, snapshot, turnHeld, walkTo } from "../src/sim.ts";

test("carry the cab from the door to the amp, put it down, stack the head on it", () => {
  const w = newWorld();
  const at = (key: string) => snapshot(w).items.find((i) => i.key === key)!;
  expect(pickUp(w, "cab-4x12")).toEqual({ ok: false, why: "4x12 cab is out of reach" });

  // To the cab out on the driveway, empty-handed at a walk.
  walkTo(w, 0.9, 8.6);
  w.you.yaw = 0;
  expect(pickUp(w, "cab-4x12")).toEqual({ ok: true });
  expect(pickUp(w, "guitar")).toEqual({ ok: false, why: "your hands are full" });
  expect(snapshot(w).holding).toBe("cab-4x12");

  // 40 kg: a shuffle, a third of walking pace, all the way in to the back wall by the amp.
  const amp = at("amp-head");
  const carrying = walkTo(w, -0.4, 1.4);
  expect(snapshot(w).you.speed).toBeCloseTo(carrySpeed(40), 2);
  expect(carrying).toBeGreaterThan((2.5 * Math.hypot(1.3, 7.2)) / WALK);
  expect(at("cab-4x12")).toMatchObject({ held: true, y: expect.any(Number) });

  // Face the back wall, turn it square, set it down: on the floor beside the amp, where it was held.
  w.you.yaw = 0;
  turnHeld(w, 1);
  expect(at("cab-4x12").rot).toBe(345);
  turnHeld(w, -1);
  expect(putDown(w)).toEqual({ ok: true });
  const cab = at("cab-4x12");
  expect(cab).toMatchObject({ held: false, y: 0, rot: 0 });
  expect(Math.hypot(cab.x - amp.x, cab.z - amp.z)).toBeLessThan(1.6);
  expect(snapshot(w).holding).toBeNull();

  // The head goes on the cab: stacked at the cab's height, and the cab can't come out from under it.
  expect(pickUp(w, "amp-head")).toEqual({ ok: true });
  walkTo(w, cab.x, cab.z + 0.55);
  w.you.yaw = 0;
  expect(putDown(w)).toEqual({ ok: true });
  expect(at("amp-head").y).toBeCloseTo(0.76, 2);
  expect(pickUp(w, "cab-4x12")).toEqual({ ok: false, why: "something is on the 4x12 cab" });
});
