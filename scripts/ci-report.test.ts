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

test("minutesBy counts every workflow's job-minutes, skipped jobs left out, most first with its share", async () => {
  const { minutesBy } = await import("./ci-report.ts");
  const at = (m: number) => new Date(Date.UTC(2026, 10, 21, 1, m)).toISOString();
  const job = (start: number, end: number, conclusion = "success") => ({ id: 1, run_id: 1, name: "j", status: "completed", conclusion, created_at: at(0), started_at: at(start), completed_at: at(end), steps: [] });
  const out = minutesBy([
    { wf: "apps.yml", jobs: [job(0, 10), job(0, 5, "skipped")] },
    { wf: "desktop-drop.yml", jobs: [job(0, 30)] },
    { wf: "apps.yml", jobs: [job(0, 10)] },
  ]);
  expect(out).toEqual([{ wf: "desktop-drop.yml", runs: 1, min: 30, share: 0.6 }, { wf: "apps.yml", runs: 2, min: 20, share: 0.4 }]);
});

test("a test failing on 3+ PRs in a day opens one issue, and not again while it is open or for that day", async () => {
  const { blockersOf, issuesFor } = await import("./ci-report.ts");
  const shelf = "test/shelf.test.ts › shelf lists the apps";
  const fail = (pr: number, h: number, tests = [shelf]) => ({ suite: "test playground", tests, touched: pr !== 1, at: new Date(2026, 10, 16, h).toISOString(), pr, run: 100 + pr });
  const big = blockersOf([fail(1, 9), fail(2, 10), fail(2, 11), fail(3, 12), fail(4, 13, ["test/other.test.ts › x"]), fail(5, 14, ["test/other.test.ts › x"])]);
  expect(big.map((b) => [b.test, b.prs, b.untouched])).toEqual([[shelf, [1, 2, 3], 1]]);

  const [issue, ...more] = issuesFor(big, []);
  expect(more).toEqual([]);
  expect(issue!.title).toBe(`CI: ${shelf} failed on 3 PRs on 2026-11-16`);
  expect(issue!.body).toContain("#1, #2, #3");
  // Mervin reads the record back from the body: the test, its PRs and the check it turns red
  const { blockerOf } = await import("../apps/agent-office/ester/blockers.ts");
  expect(blockerOf({ number: 9, body: issue!.body })).toEqual({ test: shelf, prs: [1, 2, 3], checks: ["test playground"], issue: 9 });
  expect(issuesFor(big, [{ number: 9, state: "OPEN", body: issue!.body }])).toEqual([]);
  expect(issuesFor(big, [{ number: 9, state: "CLOSED", body: issue!.body }])).toEqual([]);
  // Closed on an earlier day and failing again: a new issue.
  expect(issuesFor(big, [{ number: 9, state: "CLOSED", body: issue!.body.replace("day=2026-11-16", "day=2026-11-15") }])).toHaveLength(1);
});
