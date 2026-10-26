import { expect, test } from "bun:test";
import { pose, type RunnerScene } from "../src/runner.ts";
import { createRun, makeChart, press, type Lane } from "../src/sim.ts";

type Q = ReturnType<typeof pose>;
const run = createRun(makeChart(1));
const at = (s: Partial<RunnerScene>) => pose({ run, beat: 10.25, down: new Set(), ...s });
const still = at({});
// The upper body's lean, as the neck's offset from the hips: x is sideways, z is forward.
const lean = (q: Q) => ({ x: q.neck[0] - q.hip[0], z: q.neck[2] - q.hip[2] });

test.each([
  ["through a door it dives forward", { passBeat: 10 }, (q: Q) => expect(lean(q).z).toBeGreaterThan(lean(still).z + 0.1)],
  ["off a wall it is thrown back, arms up", { knock: 1 }, (q: Q) => {
    expect(q.hip[2]).toBeLessThan(still.hip[2]);
    expect(lean(q).z).toBeLessThan(0);
    for (const a of q.arms) expect(a.hand[1]).toBeGreaterThan(q.head[1]);
  }],
] as const)("%s", (_, s, check) => check(at(s)));

test("the knock wears off as the runner recovers", () => {
  expect(lean(at({ knock: 0.2 })).z).toBeGreaterThan(lean(at({ knock: 0.8 })).z);
  expect(at({ knock: 0 })).toEqual(still);
});

// Sidesteps the way a thumb makes them, in the count-in where nothing is judged: from lane 1 to each
// lane in turn, and the pose `after` beats into the last one.
const stepped = (lanes: Lane[], after: number) => {
  const r = createRun(makeChart(1));
  lanes.forEach((lane, i) => press(r, lane, 1 + i));
  return pose({ run: r, beat: lanes.length + after, down: new Set() });
};

test("a lane change banks into the move, harder the further it jumps, then settles upright", () => {
  // The runner starts in lane 1, left of centre.
  const one = stepped([2], 0.1), two = stepped([3], 0.1), three = stepped([0, 3], 0.1), left = stepped([0], 0.1);
  expect(one.bank).toBeGreaterThan(0);
  expect(lean(one).x).toBeGreaterThan(lean(still).x + 0.05);
  expect(left.bank).toBeLessThan(0);
  expect(lean(left).x).toBeLessThan(lean(still).x - 0.05);
  expect(two.bank).toBeGreaterThan(one.bank);
  expect(three.bank).toBeGreaterThan(two.bank);
  expect(stepped([3], 0.9).bank).toBeLessThan(two.bank / 5);
});
