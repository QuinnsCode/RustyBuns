// What Ester and Mervin "print" in the demo, in the format the wall screens read (screens/read.ts). A run is the same
// lines every time, shown in step with the clock, so a screen can be caught half-way through.
import type { EsterState } from "../ester/run.ts";

const BOARD = [
  "Mervin's board: 3 PRs onto main 0000000", "",
  "stage 1: #101 Foliage splits into map tiles", "  6 files, 100% certain   certain 6  agree 0  mervin 0  differ 0  card 0   own CI pass",
  "stage 2: #102 Walls drawn as one mesh", "  4 files, 75% certain   certain 3  agree 0  mervin 1  differ 0  card 0   own CI pass",
  "  mervin  apps/walls/src/mesh.ts  both added a route  (after main)",
  "stage 3: #103 (on #102) Live repo helpers", "  9 files, 88% certain   certain 8  agree 0  mervin 0  differ 0  card 1",
  "  card    apps/repos/src/rows.ts  both sides changed the same stretch  (after #102)",
  "clash migration: 0042  #102 + #103  settled: renumbered #103",
];

/** One line per test run, each appearing `at` seconds into a run. */
const TESTS: { at: number; line: string }[] = [
  { at: 3, line: "pass  apps/agent-office: bun test  3.1s" },
  { at: 20, line: "pass  apps/walls: bun test  12.0s" },
  { at: 52, line: "pass  apps/repos: bun test  41.0s" },
  { at: 80, line: "pass  packages/util: bun test  9.4s" },
];
const BREAK = { at: 52, line: "FAIL  apps/repos: bun test  41.0s" };
export const RUN_SECONDS = 110;

export interface Timeline { phase: EsterState["phase"]; startedAt?: number; endedAt?: number }

/** The state of a helper at `now`: running shows the lines whose time has come; a finished run shows them all. */
export function helperAt(who: "ester" | "mervin", t: Timeline, ends: "green" | "red", each: boolean, now: number): EsterState {
  if (t.phase === "idle") return { phase: "idle", lines: [], hold: [] };
  const done = t.phase === "green" || t.phase === "red";
  const secs = Math.max(0, ((t.endedAt ?? now) - (t.startedAt ?? now)) / 1000);
  const red = t.phase === "red" || (t.phase === "running" && ends === "red");
  if (who === "mervin") return { phase: t.phase, lines: BOARD, hold: [], startedAt: t.startedAt, endedAt: t.endedAt };
  const tests = TESTS.filter((x) => done || x.at <= secs).map((x) => (red && x.at === BREAK.at ? BREAK : x).line);
  const stages = each ? [101, 102, 103].filter((_, i) => done || secs > 15 + i * 30).map((pr) => (red && pr === 103 ? `stage 3 #${pr}: the board breaks apps/repos: bun test` : `stage ${pr - 100} #${pr}: ok`)) : [];
  const verdict = done ? (red ? ["Ester says hold: #103"] : ["Ester says: the stack is green"]) : [];
  return { phase: t.phase, lines: [...BOARD, ...tests, ...stages, ...verdict], hold: done && red ? [103] : [], startedAt: t.startedAt, endedAt: t.endedAt };
}

/** The wall's open and merged PRs, in the shape `gh pr list --json` gives (screens/line.ts reads these). */
export function lineAt(now: number) {
  const pass = [{ conclusion: "SUCCESS", status: "COMPLETED" }];
  const pr = (number: number, title: string, checks: unknown[], isDraft = false) => ({ number, title, url: `https://github.com/demo/repo/pull/${number}`, isDraft, statusCheckRollup: checks });
  return {
    open: [
      pr(101, "Foliage splits into map tiles", pass), pr(102, "Walls drawn as one mesh", pass), pr(103, "Live repo helpers", pass),
      pr(104, "Skate rails", [{ conclusion: "FAILURE", status: "COMPLETED" }]), pr(105, "Docs pass", [{ status: "IN_PROGRESS" }]),
      pr(106, "Draft: new park", [], true),
    ],
    merged: [90, 91, 92].map((n, i) => ({ number: n, title: `Merged ${n}`, mergedAt: new Date(now - (i + 1) * 3 * 3600_000).toISOString() })),
  };
}

export const TALLY = { prs: 14, avoided: 41, total: 52, since: Date.parse("2026-10-01T00:00:00Z") };
