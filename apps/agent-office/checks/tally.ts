// A pull request's checks at a glance, for the PR board's health bar (checks/index.ts): how many passed, failed,
// are still running or were skipped, and how long CI has taken, from the statusCheckRollup the board already lists.
// When CI reports single tests (scripts/ci-test-count.ts, read back by checks/server.ts), they're summed into tests.

export type TestCount = { pass: number; fail: number; skip: number };
export type Tally = { pass: number; fail: number; pending: number; skip: number; tests?: TestCount; startedAt?: string; completedAt?: string };

const FAILED = ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"];

export type Check = { context?: string; detailsUrl?: string | null; conclusion?: string | null; state?: string | null; status?: string | null; startedAt?: string | null; completedAt?: string | null };

/** Each check counted the way the office reads it (server/github.js checkOf), and when the first started and the last finished.
 *  testsOf gives a finished check's single tests, if CI reported any. */
export function tally(rollup: Check[] | null | undefined, testsOf?: (c: Check) => TestCount | undefined): Tally | undefined {
  if (!rollup?.length) return undefined;
  const t: Tally = { pass: 0, fail: 0, pending: 0, skip: 0 };
  let first = Infinity, last = 0;
  for (const c of rollup) {
    const concl = String(c.conclusion ?? c.state ?? "").toUpperCase();
    const status = String(c.status ?? "").toUpperCase();
    const running = !FAILED.includes(concl) && ((status && status !== "COMPLETED") || !concl || concl === "PENDING" || concl === "EXPECTED");
    if (FAILED.includes(concl)) t.fail++;
    else if (running) t.pending++;
    else if (["SKIPPED", "NEUTRAL", "STALE"].includes(concl)) t.skip++;
    else t.pass++;
    const n = running ? undefined : testsOf?.(c);
    if (n) {
      t.tests ??= { pass: 0, fail: 0, skip: 0 };
      t.tests.pass += n.pass; t.tests.fail += n.fail; t.tests.skip += n.skip;
    }
    const start = Date.parse(c.startedAt ?? ""), end = Date.parse(c.completedAt ?? "");
    if (start > 0) first = Math.min(first, start);
    if (end > 0) last = Math.max(last, end);
  }
  if (first < Infinity) t.startedAt = new Date(first).toISOString();
  // still running: the clock is still going, so no end yet
  if (!t.pending && last >= first) t.completedAt = new Date(last).toISOString();
  return t;
}

/** How long CI took, or has taken so far: "45s", "4m", "1h 12m". */
export function took(t: Tally, now = Date.now()): string {
  if (!t.startedAt) return "";
  const s = Math.max(0, Math.round(((t.completedAt ? Date.parse(t.completedAt) : now) - Date.parse(t.startedAt)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The bar grows with the number of checks, so a PR with 20 stands out from one with 2; or, once CI has counted
 *  them, with the number of single tests, on a log scale so 2000 tests still fit beside 20. */
export const barWidth = (n: number, tests?: number) =>
  tests ? Math.min(120, 14 + Math.round(24 * Math.log10(1 + tests))) : Math.min(120, 14 + 6 * n);

export const testTotal = (t: Tally) => t.tests ? t.tests.pass + t.tests.fail + t.tests.skip : 0;

/** "12 checks, 340 tests (2 failed): 10 passed, 1 failed, 1 running · 4m" */
export function describe(t: Tally, now = Date.now()): string {
  const n = t.pass + t.fail + t.pending + t.skip;
  const parts = [[t.pass, "passed"], [t.fail, "failed"], [t.pending, "running"], [t.skip, "skipped"]]
    .filter(([k]) => k).map(([k, w]) => `${k} ${w}`);
  const time = took(t, now);
  const k = testTotal(t), off = t.tests && [[t.tests.fail, "failed"], [t.tests.skip, "skipped"]].filter(([x]) => x).map(([x, w]) => `${x} ${w}`);
  const tests = k ? `, ${k} test${k === 1 ? "" : "s"}${off?.length ? ` (${off.join(", ")})` : ""}` : "";
  return `${n} check${n === 1 ? "" : "s"}${tests}: ${parts.join(", ")}${time ? ` · ${time}${t.completedAt ? "" : " so far"}` : ""}`;
}
