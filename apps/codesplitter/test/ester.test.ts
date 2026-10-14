import { describe, expect, test } from "bun:test";
import { hold, report, triage } from "../scripts/ester.ts";
import type { Stage } from "../scripts/mervin-board.ts";

const stage = (pr: number, path: string, ci?: Stage["ci"], failing?: string[]): Stage => ({ pr, head: "h", base: "b", ci, failing, files: [{ path, tier: "certain", why: "", after: [] }] });

// scripts/ester.ts: who owns each failing test when the board's --check goes red.
describe("ester", () => {
  const stages = [stage(1, "apps/a/x.ts"), stage(2, "apps/b/y.ts", "fail", ["apps"]), stage(3, "apps/c/z.ts")];
  const failed = ["apps/a: t1", "apps/b: t2", "apps/c: t3", "apps/d: t4", "apps/a: t5"];
  const vs = triage(failed, stages, new Set(["apps/d: t4"]), new Set(["apps/a: t1", "apps/b: t2", "apps/c: t3", "apps/d: t4"]));
  const by = Object.fromEntries(vs.map((v) => [v.test, v]));

  test("sorts each failure by owner", () => {
    expect(by["apps/d: t4"]!.owner).toBe("main");
    expect(by["apps/a: t5"]!.owner).toBe("flaky");
    expect(by["apps/b: t2"]).toMatchObject({ owner: "own", prs: [2] });
    expect(by["apps/a: t1"]).toMatchObject({ owner: "blocks", prs: [1] });
    expect(by["apps/c: t3"]!.prs).toEqual([3]);
  });

  test("without a rerun nothing is called flaky, and the report leaves main's failures out", () => {
    expect(triage(["apps/a: t5"], stages, new Set())[0]!.owner).toBe("blocks");
    const lines = report(vs);
    expect(lines[0]).toContain("5 failing, 1 not the board's, 1 flaky, 1 a PR's own red, 0 waiting on CI, 2 block Mervin");
    expect(lines.join("\n")).not.toContain("apps/d: t4");
  });

  test("reports run, rerun and CI times", () => {
    const lines = report(vs, [{ dir: "apps/a", cmd: "bun test", ms: 41000 }, { dir: ".", cmd: "bun run typecheck", ms: 90000 }], [41000], [{ ...stages[0]!, ciSecs: 360 }]).join("\n");
    expect(lines).toContain("slowest runs: .: bun run typecheck 90s, apps/a: bun test 41s");
    expect(lines).toContain("the flaky rerun took 41s");
    expect(lines).toContain("slowest PR CI: #1 6m");
  });

  test("a PR whose CI is still pending is waited on, and every culprit PR is held", () => {
    const w = triage(["apps/e: t"], [stage(7, "apps/e/q.ts", "pending")], new Set());
    expect(w[0]).toMatchObject({ owner: "wait", prs: [7] });
    expect(hold([...vs, ...w])).toEqual([1, 2, 3, 7]);
  });
});
