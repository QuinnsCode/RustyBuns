import { expect, test } from "bun:test";
import { numstat, reasonLine, revertsByApp, score, type Facts } from "./lane.ts";

const bites = { tests: 2, failOnBase: 2, changed: 40, unrun: 4 };

test.each<[string, Facts, number, "fast" | "standby"]>([
  ["one small app PR whose tests bite", { files: [{ path: "apps/skate/src/a.ts", lines: 40 }, { path: "apps/skate/src/a.test.ts", lines: 30 }], bites, reverts: {} }, 100, "fast"],
  ["the same with no tests", { files: [{ path: "apps/skate/src/a.ts", lines: 40 }], reverts: {} }, 60, "fast"],
  ["an app that keeps going red", { files: [{ path: "apps/skate/src/a.ts", lines: 40 }], reverts: { skate: 2 } }, 35, "standby"],
  ["shared code", { files: [{ path: "packages/util/src/x.ts", lines: 40 }], bites, reverts: {} }, 55, "standby"],
  ["CI wiring never goes fast", { files: [{ path: ".github/workflows/apps.yml", lines: 10 }, { path: "apps/skate/src/a.ts", lines: 10 }], bites: { ...bites, changed: 10, unrun: 0 }, reverts: {} }, 45, "standby"],
  ["a big PR across two apps", { files: [{ path: "apps/skate/a.ts", lines: 400 }, { path: "apps/frameworks/astro-example/b.ts", lines: 200 }], reverts: {} }, 20, "standby"],
  ["the lockfile isn't counted in size", { files: [{ path: "apps/skate/a.ts", lines: 20 }, { path: "bun.lock", lines: 900 }], reverts: {} }, 30, "standby"],
  ["words only", { files: [{ path: "notes/x.md", lines: 20 }], reverts: {} }, 45, "standby"],
])("score: %s", (_, facts, want, lane) => {
  const r = score(facts);
  expect([r.score, r.lane]).toEqual([want, lane]);
});

test("reasonLine names the lane, score and parts", () => {
  expect(reasonLine(score({ files: [{ path: "apps/skate/src/a.ts", lines: 40 }], reverts: {} })))
    .toBe("lane:fast (score 60, 60 or more): one app (skate) +30, no test changed +0, 40 lines +15, no reverts in 30 days +15");
});

test("numstat and revertsByApp read git's output", () => {
  expect(numstat("3\t1\tapps/skate/a.ts\n-\t-\tapps/skate/b.png\n")).toEqual([{ path: "apps/skate/a.ts", lines: 4 }, { path: "apps/skate/b.png", lines: 0 }]);
  const log = "\0Revert \"Skate thing (#1)\"\n\napps/skate/a.ts\napps/skate/b.ts\n\0Skate (#2)\n\napps/skate/a.ts\n\0revert x\n\napps/frameworks/astro-example/c.ts\n";
  expect(revertsByApp(log)).toEqual({ skate: 1, "astro-example": 1 });
});
