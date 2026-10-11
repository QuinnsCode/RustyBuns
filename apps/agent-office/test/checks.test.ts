import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";
import { checksBarClient, checkTallyServer, SERVER_IMPORT } from "../checks/patch.ts";
import { barWidth, describe, tally, took } from "../checks/tally.ts";
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
