import { expect, test } from "bun:test";
import { fileTimes, ringPick } from "./ci-report.ts";

test("fileTimes sums each file's test times from bun's own [ms] marks, slowest first", () => {
  const log = [
    "2026-11-21T04:38:46.98Z ##[group]test/fast.test.ts:",
    "2026-11-21T04:39:00.81Z (pass) one [250.00ms]",
    "2026-11-21T04:39:00.82Z (pass) two [0.50ms]",
    "2026-11-21T04:39:00.82Z ##[endgroup]",
    "2026-11-21T04:39:00.83Z ##[group]test/slow.test.ts:",
    "2026-11-21T04:39:03.06Z (fail) three [2.50s]",
    "2026-11-21T04:39:03.06Z (pass) four [1000.00ms]",
  ].join("\n");
  expect(fileTimes(log)).toEqual([["test/slow.test.ts", 3.5], ["test/fast.test.ts", 0.2505]]);
});

test("ringPick sends a costly suite that rarely catches its PR to hourly, and otherwise only its shared-change runs", () => {
  expect(ringPick({ perRun: 5.6, caughtWeek: 2, fanMin: 900 })).toBe("hourly: whole suite");
  expect(ringPick({ perRun: 8.8, caughtWeek: 23, fanMin: 1500 })).toBe("hourly: shared-change runs");
  expect(ringPick({ perRun: 1, caughtWeek: 0, fanMin: 0 })).toBe("keep on PRs");
});

// #4136: GitHub's job API leaves out a lane's test step (its name is its whole file list); the uncovered time is test time.
test("a test job's time no listed step covers counts as test, elsewhere as other", async () => {
  const { splitOf } = await import("./ci-report.ts");
  const at = (s: number) => new Date(Date.UTC(2026, 10, 21, 1, 0, s)).toISOString();
  const steps = [
    { name: "Run actions/checkout@3d3c42e", started_at: at(0), completed_at: at(30) },
    { name: "Run bun install --frozen-lockfile", started_at: at(30), completed_at: at(60) },
  ];
  const lane = splitOf({ name: "test mythic-masters 2/3", started_at: at(0), completed_at: at(180), steps });
  expect(lane).toEqual({ checkout: 0.5, setup: 0, install: 0.5, test: 2, other: 0 });
  expect(splitOf({ name: "plan", started_at: at(0), completed_at: at(90), steps }).other).toBe(0.5);
});
