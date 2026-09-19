import { test, expect } from "bun:test";
import { DEFAULT_GUN, due, pull, spreadOf } from "../src/gun.ts";

const gun = { ...DEFAULT_GUN, ratePerSecond: 10, maxPerFrame: 2 };   // one round per 100 ms

test("holding the trigger fires at the gun's rate", () => {
  const t = pull(gun, 0, 0, 1000);            // the press itself is round 1
  let fired = 1;
  for (let frame = 1; frame * 16 <= 1000; frame++) fired += due(gun, t, 1000 + frame * 16);   // 60 fps
  fired += due(gun, t, 2000);                 // the last frame of the second
  expect(fired).toBe(11);                     // 1 + 10 per second
});

test("a stalled frame can't empty the magazine", () => {
  const t = pull(gun, 0, 0, 0);
  expect(due(gun, t, 5000)).toBe(gun.maxPerFrame);   // 5 s of backlog, capped
  expect(due(gun, t, 5001)).toBe(0);                 // and the backlog is dropped, not saved up
});

test("a slow but steady 20 fps still fires the right number of rounds", () => {
  const t = pull(gun, 0, 0, 0);
  let fired = 1;
  for (let now = 0; now <= 1000; now += 50) fired += due(gun, t, now);
  expect(fired).toBe(11);
});

test("tapping fires exactly one round", () => {
  const t = pull(gun, 0, 0, 0);
  expect(due(gun, t, 30)).toBe(0);
});

test("spread climbs while held, then stops at the cap", () => {
  const t = pull(gun, 0, 0, 0);
  expect(spreadOf(gun, t, 0)).toBe(gun.spreadDeg);
  expect(spreadOf(gun, t, 1000)).toBeCloseTo(gun.spreadDeg + gun.climbPerSecond, 5);
  expect(spreadOf(gun, t, 60_000)).toBe(gun.maxSpreadDeg);
});
