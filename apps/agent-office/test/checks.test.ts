import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";
import { checksBarClient, checkTallyServer, SERVER_IMPORT } from "../checks/patch.ts";
import { countOf as annotated, TestCounts } from "../checks/server.ts";
import { barWidth, describe, tally, took } from "../checks/tally.ts";
import { countOf, notice } from "../../../scripts/ci-test-count.ts";
import { askOf, read, unpackPinned } from "./pinned.ts";

// the first run downloads the pinned release into .cache, as rustybunsify.ts does
setDefaultTimeout(60_000);

let pkg = "";
beforeAll(async () => { pkg = await unpackPinned(); });

const run = (conclusion: string | null, startedAt: string, completedAt?: string, status = conclusion ? "COMPLETED" : "IN_PROGRESS") =>
  ({ __typename: "CheckRun", conclusion, status, startedAt, completedAt: completedAt ?? "0001-01-01T00:00:00Z" });

test("a PR's checks counted by how they went, and CI timed from the first start to the last finish", () => {
  const t = tally([
    run("SUCCESS", "2026-10-11T08:00:00Z", "2026-10-11T08:01:00Z"),
    run("FAILURE", "2026-10-11T08:00:10Z", "2026-10-11T08:04:30Z"),
    run("SKIPPED", "2026-10-11T08:00:05Z", "2026-10-11T08:00:06Z"),
    { context: "deploy/preview", state: "SUCCESS" },
  ])!;
  expect(t).toEqual({ pass: 2, fail: 1, pending: 0, skip: 1, startedAt: "2026-10-11T08:00:00.000Z", completedAt: "2026-10-11T08:04:30.000Z" });
  expect(took(t)).toBe("5m");
  expect(describe(t)).toBe("4 checks: 2 passed, 1 failed, 1 skipped · 5m");
});

test("still running, the clock keeps going", () => {
  const t = tally([run("SUCCESS", "2026-10-11T08:00:00Z", "2026-10-11T08:00:30Z"), run(null, "2026-10-11T08:00:00Z")])!;
  expect(t.pending).toBe(1);
  expect(t.completedAt).toBeUndefined();
  expect(took(t, Date.parse("2026-10-11T08:00:42Z"))).toBe("42s");
  expect(describe(t, Date.parse("2026-10-11T09:12:00Z"))).toBe("2 checks: 1 passed, 1 running · 1h 12m so far");
});

test("no checks, no bar; more checks, a longer one, up to a point", () => {
  expect(tally([])).toBeUndefined();
  expect(tally(undefined)).toBeUndefined();
  expect(barWidth(2)).toBeLessThan(barWidth(20));
  expect(barWidth(200)).toBe(120);
});

test("CI's test summary becomes a notice the office reads back", () => {
  const out = "bun test v1.4.3\n\x1b[32m 340\x1b[0m pass\n 2 skip\n 1 todo\n 3 fail\n 9 expect() calls\nRan 346 tests across 12 files.\n";
  const t = countOf(out)!;
  expect(t).toEqual({ pass: 340, fail: 3, skip: 3 });
  expect(countOf(out + " 10 pass\n")!.pass).toBe(350);
  expect(countOf("no tests here")).toBeUndefined();
  expect(notice(t)).toBe("::notice title=tests::340 pass, 3 fail, 3 skip");
  expect(annotated([{ title: "other", message: "1 pass, 0 fail, 0 skip" }, { title: "tests", message: notice(t).split("::")[2] }])).toEqual(t);
  expect(annotated([])).toBeUndefined();
});

test("each finished check run's tests are asked for once, then summed into the tally", async () => {
  const asked: string[] = [];
  const counts = new TestCounts(async (p) => {
    asked.push(p);
    return JSON.stringify(p.includes("/11/") ? [{ title: "tests", message: "200 pass, 2 fail, 1 skip" }] : p.includes("/12/") ? [{ title: "tests", message: "40 pass, 0 fail, 0 skip" }] : []);
  });
  const job = (id: number, conclusion: string | null) => ({ ...run(conclusion, "2026-10-11T08:00:00Z", "2026-10-11T08:01:00Z"), detailsUrl: `https://github.com/o/r/actions/runs/9/job/${id}` });
  const rollup = [job(11, "FAILURE"), job(12, "SUCCESS"), job(13, "SUCCESS"), job(14, "SKIPPED"), job(15, null), { context: "deploy", state: "SUCCESS" }];
  expect(tally(rollup, counts.of)!.tests).toBeUndefined();
  await Bun.sleep(0);
  const t = tally(rollup, counts.of)!;
  expect(t.tests).toEqual({ pass: 240, fail: 2, skip: 1 });
  // skipped and still-running checks, and checks with no count, aren't asked again
  expect(asked.sort()).toEqual(["repos/o/r/check-runs/11/annotations", "repos/o/r/check-runs/12/annotations", "repos/o/r/check-runs/13/annotations"]);
  expect(describe(t, Date.parse("2026-10-11T08:02:00Z"))).toBe("6 checks, 243 tests (2 failed, 1 skipped): 3 passed, 1 failed, 1 running, 1 skipped · 2m so far");
  expect(barWidth(6, 243)).toBeGreaterThan(barWidth(6, 40));
  expect(barWidth(6, 1e9)).toBe(120);
});

test("a failed call is asked again on the next list", async () => {
  let calls = 0;
  const counts = new TestCounts(async () => { if (++calls === 1) throw new Error("rate limited"); return JSON.stringify([{ title: "tests", message: "5 pass, 0 fail, 0 skip" }]); });
  const c = { conclusion: "SUCCESS", detailsUrl: "https://github.com/o/r/actions/runs/1/job/2" };
  expect(counts.of(c)).toBeUndefined();
  await Bun.sleep(0);
  expect(counts.of(c)).toBeUndefined();
  await Bun.sleep(0);
  expect(counts.of(c)).toEqual({ pass: 5, fail: 0, skip: 0 });
  expect(calls).toBe(2);
});

test("the pinned release's PR list gains each PR's tally", async () => {
  const file = path.join(pkg, "dist/server/server/github.js");
  const patched = SERVER_IMPORT + checkTallyServer(read(file));
  expect(patched.split("checkTally: __rbTally(p.statusCheckRollup)").length).toBe(2);
  expect(() => new Bun.Transpiler({ loader: "js" }).scan(patched)).not.toThrow();
  expect(() => checkTallyServer(patched.replace(SERVER_IMPORT, ""))).toThrow(/patch target moved/);
});

test("the pinned release's PR card shows the bar in place of its checks dot, and falls back to the dot", () => {
  const js = read(askOf(pkg));
  const patched = checksBarClient(js);
  expect(patched.split("globalThis.__rbChecksBar?.(e)??km[e.checks]").length).toBe(2);
  expect(patched.replace("globalThis.__rbChecksBar?.(e)??", "")).toBe(js);
  expect(() => new Bun.Transpiler({ loader: "js" }).scan(patched)).not.toThrow();
  expect(() => checksBarClient(patched)).toThrow(/patch target moved/);
  expect(() => checksBarClient("")).toThrow(/Agent Office changed/);
});
