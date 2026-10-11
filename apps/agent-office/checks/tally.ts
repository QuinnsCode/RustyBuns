// A pull request's checks at a glance, for the PR board's health bar (checks/index.ts): how many passed, failed,
// are still running or were skipped, and how long CI has taken, from the statusCheckRollup the board already lists.

export type Tally = { pass: number; fail: number; pending: number; skip: number; startedAt?: string; completedAt?: string };

const FAILED = ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"];

type Check = { context?: string; conclusion?: string | null; state?: string | null; status?: string | null; startedAt?: string | null; completedAt?: string | null };

/** Each check counted the way the office reads it (server/github.js checkOf), and when the first started and the last finished. */
export function tally(rollup: Check[] | null | undefined): Tally | undefined {
  if (!rollup?.length) return undefined;
  const t: Tally = { pass: 0, fail: 0, pending: 0, skip: 0 };
  let first = Infinity, last = 0;
  for (const c of rollup) {
    const concl = String(c.conclusion ?? c.state ?? "").toUpperCase();
    const status = String(c.status ?? "").toUpperCase();
    if (FAILED.includes(concl)) t.fail++;
    else if ((status && status !== "COMPLETED") || !concl || concl === "PENDING" || concl === "EXPECTED") t.pending++;
    else if (["SKIPPED", "NEUTRAL", "STALE"].includes(concl)) t.skip++;
    else t.pass++;
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

/** The bar grows with the number of checks, so a PR with 20 stands out from one with 2. */
export const barWidth = (n: number) => Math.min(120, 14 + 6 * n);

/** "12 checks: 10 passed, 1 failed, 1 running · 4m" */
export function describe(t: Tally, now = Date.now()): string {
  const n = t.pass + t.fail + t.pending + t.skip;
  const parts = [[t.pass, "passed"], [t.fail, "failed"], [t.pending, "running"], [t.skip, "skipped"]]
    .filter(([k]) => k).map(([k, w]) => `${k} ${w}`);
  const time = took(t, now);
  return `${n} check${n === 1 ? "" : "s"}: ${parts.join(", ")}${time ? ` · ${time}${t.completedAt ? "" : " so far"}` : ""}`;
}
