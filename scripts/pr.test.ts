import { expect, test } from "bun:test";
import { MISS_AFTER, jobOf, missedRun, outcomes, settled, summarize, trimLog, type Pr } from "./pr.ts";

const now = Date.parse("2026-11-01T10:00:00Z");
const run = (name: string, conclusion: string | undefined, status = "COMPLETED", workflowName = "apps") =>
  ({ name, status, conclusion, workflowName, detailsUrl: "https://github.com/QuinnsCode/RustyBuns/actions/runs/41292692684/job/124807173865", startedAt: "2026-11-01T09:20:19Z", completedAt: status === "COMPLETED" ? "2026-11-01T09:21:40Z" : undefined });
const pr = (over: Partial<Pr> = {}): Pr => ({
  number: 3155, title: "A title", url: "https://github.com/QuinnsCode/RustyBuns/pull/3155", state: "OPEN", isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
  baseRefName: "main", headRefName: "office/x", headRefOid: "875bd8d0000", commits: [{ committedDate: "2026-11-01T09:19:00Z" }],
  statusCheckRollup: [run("typecheck", "SUCCESS", "COMPLETED", "typecheck"), run("test mythic-masters", "SUCCESS"), run("packages", "SKIPPED")], ...over,
});

test("a green PR is one pass line with each check's time, and settled", () => {
  const p = pr();
  expect(settled(p, now)).toBe(true);
  expect(summarize(p, now)).toEqual(["#3155 OPEN clean main <- office/x 875bd8d  A title", "  pass    typecheck 1m21s | test mythic-masters 1m21s", "  skip    packages"]);
});

test("a running check keeps it unsettled; a failed one gets its own line with the link", () => {
  const p = pr({ statusCheckRollup: [run("typecheck", undefined, "IN_PROGRESS", "typecheck"), run("test codesplitter", "FAILURE")] });
  expect(settled(p, now)).toBe(false);
  expect(outcomes(p).map((o) => o.outcome)).toEqual(["pending", "fail"]);
  const lines = summarize(p, now);
  expect(lines[1]).toBe("  running typecheck");
  expect(lines[2]).toBe("  FAIL    test codesplitter 1m21s  https://github.com/QuinnsCode/RustyBuns/actions/runs/41292692684/job/124807173865");
  expect(jobOf(lines[2]!)).toEqual({ run: "41292692684", job: "124807173865" });
});

test("a head minutes old with no typecheck or apps run is the GitHub miss, and a merged PR is settled whatever its checks", () => {
  const fresh = pr({ statusCheckRollup: [], commits: [{ committedDate: new Date(now - 30_000).toISOString() }] });
  expect(settled(fresh, now)).toBe(false);
  expect(summarize(fresh, now)[1]).toBe("  no checks yet");
  const stale = pr({ statusCheckRollup: [], commits: [{ committedDate: new Date(now - (MISS_AFTER + 60) * 1000).toISOString() }] });
  expect(missedRun(stale, now)).toBe(true);
  expect(settled(stale, now)).toBe(true);
  expect(summarize(stale, now)[1]).toContain("#2828");
  expect(settled(pr({ state: "MERGED", statusCheckRollup: [run("typecheck", undefined, "IN_PROGRESS")] }), now)).toBe(true);
});

test("a non-Actions status context reads by its state", () => {
  const p = pr({ statusCheckRollup: [{ context: "deploy/preview", state: "PENDING" }, { context: "deploy/prod", state: "SUCCESS" }] });
  expect(outcomes(p).map((o) => `${o.name}:${o.outcome}`)).toEqual(["deploy/preview:pending", "deploy/prod:pass"]);
});

test("the failed log keeps the tail without the job, step and timestamp prefix, colour or group markers", () => {
  const log = ["test x\tRun tests\t2026-11-01T09:20:32.1234567Z ##[group]Run bun test", "test x\tRun tests\t2026-11-01T09:20:32.1234567Z \x1b[31mexpect(received).toBe(expected)\x1b[0m", "test x\tRun tests\t2026-11-01T09:20:33.0000000Z ", "test x\tRun tests\t2026-11-01T09:20:33.0000000Z ##[endgroup]", "test x\tRun tests\t2026-11-01T09:20:34.0000000Z 1 fail", "test x\tRun tests\t2026-11-01T09:20:34.0000000Z Post job cleanup."].join("\n");
  expect(trimLog(log)).toEqual(["expect(received).toBe(expected)", "1 fail"]);
  expect(trimLog(Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"), 3)).toEqual(["… 47 earlier lines", "line 47", "line 48", "line 49"]);
});
