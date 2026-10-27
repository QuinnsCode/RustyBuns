// Journeys for where the board lands on a bar and how it balances there. All headless, through the same step() the page runs.
import { expect, test } from "bun:test";
import { clamp } from "@rustybuns/util";
import { type Level, makeLevel } from "../src/level.ts";
import { DT, IDLE, type Input, start, step, type State } from "../src/sim.ts";

const bar = makeLevel({ name: "t", pieces: [], spawns: [], bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 }, rails: [{ kind: "rail", a: { x: 0, z: 0 }, b: { x: 0, z: 60 }, y: 0.9 }] });
const run = (s: State, seconds: number, input: (s: State) => Partial<Input>, level: Level) => {
  for (let i = 0; i < seconds / DT; i++) step(s, { ...IDLE, ...input(s) }, level);
  return s;
};
// Drops at `yaw` with the deck's `at` (-1 tail tip, 1 nose tip, kept just inside the ends) over the bar.
const drop = (yaw: number, at: number) => {
  const reach = at * 2.2;
  const sk = start(-Math.sin(yaw) * 0.2, 2, yaw, bar);
  // put the deck's `at` point on the bar: the bar is x = 0, the point sits `reach` along the heading from the board's middle
  sk.x = -Math.sin(yaw) * reach;
  sk.z = 2 - Math.cos(yaw) * reach;
  sk.air = true; sk.y = 1.0; sk.vy = -1; sk.vx = Math.sin(yaw) * 12; sk.vz = Math.cos(yaw) * 12;
  return sk;
};
const hold = (s: State) => ({ steer: clamp(s.balance * 2, -1, 1) });

test("the part of the deck that lands on the bar names the grind", () => {
  const cases: [string, number, number, string][] = [
    ["along, middle", 0, 0, "50-50"],
    ["across, middle", Math.PI / 2, 0, "boardslide"],
    ["across, tail over", Math.PI / 2, -0.9, "tailslide"],
    ["across, nose over", Math.PI / 2, 0.9, "noseslide"],
    ["angled, middle", 0.7, 0, "nosegrind"],
    ["angled, back truck", 0.7, -0.8, "5-0"],
    ["angled, front truck", 0.7, 0.8, "nosegrind"],
    ["nearly across, front truck", 1, 0.8, "crooked"],
    ["nearly across, back truck", 1, -0.8, "smith"],
  ];
  for (const [what, yaw, at, kind] of cases) {
    const sk = run(drop(yaw, at), 0.4, hold, bar);
    expect([what, sk.grind, sk.grindKind]).toEqual([what, 0, kind]);
  }
});

test("a grind is held by correcting the lean, and falls off when left alone", () => {
  for (const [yaw, at] of [[0, 0], [0.7, 0.8], [Math.PI / 2, -0.9], [Math.PI / 2, 0]] as const) {
    const held = run(drop(yaw, at), 0.5, hold, bar); // still sliding: at 5 m/s² it has a few seconds in it
    expect([yaw, at, held.grind]).toEqual([yaw, at, 0]);
    const alone = run(drop(yaw, at), 6, () => ({}), bar);
    expect(alone.grind).toBe(-1);
    expect(alone.last?.name).not.toBe(held.last?.name ?? ""); // it came off the bar (a bail or a stall), not still on it
  }
});

test("a nosegrind sits further over than a 50-50, and the stick takes a moment to act", () => {
  const rest = (yaw: number, at: number) => run(drop(yaw, at), 1, hold, bar);
  expect(Math.abs(rest(0.7, 0.8).balance)).toBeGreaterThanOrEqual(Math.abs(rest(0, 0).balance));
  const sk = run(drop(0, 0), 0.05, () => ({ steer: 1 }), bar);
  expect(sk.push).toBeLessThan(0.5); // a full stick has not yet reached the body
});
