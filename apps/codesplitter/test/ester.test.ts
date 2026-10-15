import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hold, hurtLines, hurting, keep, kept, packagesChanged, report, rows, triage } from "../scripts/ester.ts";
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

describe("ester: dependencies that hurt", () => {
  const pj = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });
  test("a package counts when its range changes, not when the file does", () => {
    expect(packagesChanged(pj({ a: "1", b: "1" }), pj({ a: "2", b: "1", c: "1" }))).toEqual(["a", "c"]);
    expect(packagesChanged(null, "not json")).toEqual([]);
  });

  test("ranks by breaks and clashes, with the clash rate against touches", () => {
    const st = [{ ...stage(1, "apps/a/x.ts"), pkgs: ["zod"] }, { ...stage(2, "apps/a/y.ts"), pkgs: ["zod", "hono"] }, { ...stage(3, "apps/b/z.ts"), pkgs: ["hono"] }, { ...stage(4, "apps/b/w.ts"), pkgs: ["calm"] }];
    const vs = triage(["apps/a: t"], st, new Set());
    const rs = rows(st, vs, [{ prs: [2, 3] }]);
    expect(hurting(rs).map((h) => [h.pkg, h.touches, h.broke, h.clashes])).toEqual([["hono", 2, 1, 2], ["zod", 2, 2, 1], ["calm", 1, 0, 0]]);
    expect(hurting(rs)[0]!.rate).toBe(1);
    expect(hurtLines(rs).join("\n")).not.toContain("calm");
    expect(hurtLines(rows(st, [], []))).toEqual([]);
  });
});

describe("ester: rows kept across runs", () => {
  test("a later run adds PRs and replaces a rerun PR's row, and the ranking spans both", () => {
    const dir = mkdtempSync(join(tmpdir(), "ester-"));
    try {
      const file = join(dir, "sub/rows.jsonl");
      expect(kept(file)).toEqual([]);
      keep(file, [{ pr: 1, apps: [], pkgs: ["zod"], owners: ["blocks"], clashed: false }], "t1");
      appendFileSync(file, "{torn\n");
      keep(file, [{ pr: 1, apps: [], pkgs: ["zod"], owners: [], clashed: false }, { pr: 2, apps: [], pkgs: ["zod"], owners: ["own"], clashed: true }], "t2");
      const rs = kept(file);
      expect(rs.map((r) => r.pr)).toEqual([1, 2]);
      expect(hurting(rs).map((h) => [h.pkg, h.touches, h.broke, h.clashes])).toEqual([["zod", 2, 1, 1]]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
