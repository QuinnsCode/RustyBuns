import { describe, expect, test } from "bun:test";
import { nextShot, plan, readiness } from "../src/shots.ts";

describe("a seller working through a capture", () => {
  const orbit = plan("orbit");
  const all = new Set(orbit.map((s) => s.i));
  const without = (drop: (i: number) => boolean) => new Set([...all].filter((i) => !drop(i)));
  const low = orbit.filter((s) => s.ring === "low").map((s) => s.i);

  test.each([
    ["nothing yet", new Set<number>(), false, ["low", "mid", "high", "under"]],
    ["every shot", all, true, []],
    ["every other low shot skipped", without((i) => low.includes(i) && i % 2 === 1), false, ["low"]],
    ["one low shot missed", without((i) => i === low[3]), true, []],
    ["a 60° hole in the low ring (wraps past front)", without((i) => [low[22], low[23], low[0], low[1]].includes(i)), false, []],
    ["never flipped it over", without((i) => orbit[i]!.ring === "under"), false, ["under"]],
  ] as const)("%s", (_, taken, ready, thin) => {
    const r = readiness(orbit, taken);
    expect(r.ready).toBe(ready);
    expect(r.thin).toEqual([...thin]);
  });

  test("the six-view plan is six shots, done when all six are in, with no gap math", () => {
    const six = plan("six");
    expect(six.map((s) => s.say)).toContain("Bottom (flip it over)");
    expect(readiness(six, new Set([0, 1, 2, 3, 4, 5]))).toMatchObject({ ready: true, widestGap: 0 });
    expect(readiness(six, new Set([0, 1, 2]))).toMatchObject({ ready: false, thin: ["side"] });
  });

  test("next shot walks the plan in order and skips what's done", () => {
    expect(nextShot(orbit, new Set([0, 1]))?.i).toBe(2);
    expect(nextShot(orbit, all)).toBeUndefined();
  });
});
