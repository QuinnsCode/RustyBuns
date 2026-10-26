import { expect, test } from "bun:test";
import { pose, type RunnerScene } from "../src/runner.ts";
import { createRun, makeChart } from "../src/sim.ts";

type Q = ReturnType<typeof pose>;
const run = createRun(makeChart(1));
const at = (s: Partial<RunnerScene>) => pose({ run, beat: 10.25, down: new Set(), ...s });
const still = at({});
// The upper body's lean, as the neck's offset from the hips: x is sideways, z is forward.
const lean = (q: Q) => ({ x: q.neck[0] - q.hip[0], z: q.neck[2] - q.hip[2] });

test.each([
  ["moving right leans right", { vx: 4 }, (q: Q) => expect(lean(q).x).toBeGreaterThan(lean(still).x + 0.1)],
  ["moving left leans left", { vx: -4 }, (q: Q) => expect(lean(q).x).toBeLessThan(lean(still).x - 0.1)],
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
