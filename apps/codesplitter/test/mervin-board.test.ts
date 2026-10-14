import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciOf, order, run, score, type BoardPr } from "../scripts/mervin-board.ts";

// scripts/mervin-board.ts: the open PRs merged in a sandbox one stage at a time, then scored against what landed.
describe("mervin board", () => {
  const repo = mkdtempSync(join(tmpdir(), "mervin-board-"));
  const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: repo, stderr: "pipe" }).stdout.toString().trim();
  const commit = (files: Record<string, string>, msg: string) => {
    for (const [p, t] of Object.entries(files)) writeFileSync(join(repo, p), t);
    git("add", "-A"); git("commit", "-qm", msg);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  const main = commit({ "a.ts": "a\nb\nc\n", "b.ts": "one\ntwo\n", "c.ts": "x\n" }, "base");
  git("checkout", "-qb", "p1");
  const p1 = commit({ "a.ts": "A\nb\nc\n", "c.ts": "X\np1\n" }, "p1");
  git("checkout", "-qb", "p2", main);
  const p2 = commit({ "a.ts": "a\nB\nc\n", "b.ts": "one\ntwo\nthree\n" }, "p2");
  git("checkout", "-qb", "p3", p1);
  const p3 = commit({ "c.ts": "X\np1\np3\n" }, "p3 on p1");
  git("checkout", "-qb", "p4", main);
  const p4 = commit({ "c.ts": "y\n" }, "p4");
  const prs: BoardPr[] = [
    { number: 4, headRefOid: p4, headRefName: "p4", baseRefName: "main" },
    { number: 3, headRefOid: p3, headRefName: "p3", baseRefName: "p1" },
    { number: 2, headRefOid: p2, headRefName: "p2", baseRefName: "main" },
    { number: 1, headRefOid: p1, headRefName: "p1", baseRefName: "main" },
  ];

  test("oldest first, a stacked PR right after the one it's built on, or the order given", () => {
    expect(order(prs).map((p) => p.number)).toEqual([1, 2, 3, 4]);
    expect(order([prs[1]!, { ...prs[3]!, number: 9 }]).map((p) => p.number)).toEqual([9, 3]);
    expect(order(prs, [2, 1]).map((p) => p.number)).toEqual([2, 1]);
  });

  test("each stage files every file in a tier, and never writes a ref", () => {
    const refs = git("for-each-ref");
    const { board, tree } = run(repo, main, order(prs));
    expect(git("for-each-ref")).toBe(refs);
    const tiers = board.stages.map((s) => Object.fromEntries(s.files.map((f) => [f.path, f.tier])));
    expect(tiers).toEqual([
      { "a.ts": "certain", "c.ts": "certain" },
      { "a.ts": "mervin", "b.ts": "certain" },   // next-door lines: git conflicts, Mervin settles
      { "c.ts": "certain" },                     // stacked: merged from p1, which is already in
      { "c.ts": "card" },                        // rewrote the line p1 rewrote too
    ]);
    expect(board.stages[3]!.files[0]!.after).toEqual([1, 3]);
    expect(tree.get("a.ts")).toBe("A\nB\nc\n");
    expect(tree.get("c.ts")).toBe("X\np1\np3\n");
  });

  test("a conflict with main is blamed on main, not on an earlier PR", () => {
    git("checkout", "-qb", "m2", main);
    const moved = commit({ "c.ts": "main\n" }, "main moves c.ts");
    const { board } = run(repo, moved, order(prs, [4, 1]));
    const c = (i: number) => board.stages[i]!.files.find((f) => f.path === "c.ts")!;
    expect(c(0)).toMatchObject({ tier: "card", after: [], main: true });
    expect(c(1)).toMatchObject({ tier: "card", after: [], main: true });
    expect(board.stages[0]!.files.find((f) => f.path === "a.ts")).toBeUndefined();
  });

  test("the score: exact, wrong, asked, and a file someone else moved", () => {
    const { board, tree } = run(repo, main, order(prs, [1, 2, 4]));
    const dir = mkdtempSync(join(tmpdir(), "mervin-board-tree-"));
    try {
      for (const [p, t] of tree) writeFileSync(join(dir, p), t!);
      git("checkout", "-q", "main");
      commit({ "a.ts": "A\nB\nc\n", "c.ts": "X\np1\n" }, "p1 (#1)");
      commit({ "b.ts": "one\nTWO\nthree\n" }, "p2 (#2)");
      commit({ "c.ts": "y\n" }, "p4 (#4)");
      const { landed, rows } = score(repo, board, dir, git("rev-parse", "HEAD"));
      expect(landed).toEqual([1, 2, 4]);
      expect(Object.fromEntries(rows.map((r) => [r.path, r.score]))).toEqual({ "a.ts": "exact", "b.ts": "wrong", "c.ts": "asked" });
      commit({ "a.ts": "other\n" }, "outside the board (#99)");
      expect(score(repo, board, dir, git("rev-parse", "HEAD")).rows.find((r) => r.path === "a.ts")!.score).toBe("moved");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a PR's own CI: red when any check failed, pending while one runs", () => {
    const pr = (rollup: BoardPr["statusCheckRollup"]) => ciOf({ number: 1, headRefOid: "x", statusCheckRollup: rollup });
    expect(pr([{ name: "typecheck", conclusion: "SUCCESS", status: "COMPLETED" }, { name: "test codesplitter", conclusion: "FAILURE", status: "COMPLETED" }])).toEqual({ ci: "fail", failing: ["test codesplitter"] });
    expect(pr([{ name: "typecheck", conclusion: "", status: "IN_PROGRESS" }]).ci).toBe("pending");
    expect(pr([{ name: "typecheck", conclusion: "SKIPPED", status: "COMPLETED" }]).ci).toBe("pass");
    expect(pr([]).ci).toBe("none");
  });

  test("a PR not landed yet is waiting, not scored", () => {
    const { board } = run(repo, main, order(prs, [1]));
    mkdirSync(join(repo, "none"), { recursive: true });
    expect(score(repo, board, join(repo, "none"), main).rows.every((r) => r.score === "waiting")).toBe(true);
  });
});

// scripts/mervin-merge.ts: which PRs go now, which wait, and why.
import { decide } from "../scripts/mervin-merge.ts";
describe("mervin merge round", () => {
  const row = (path: string, tier: "certain" | "card", after: number[] = []) => ({ path, tier, why: "", after });
  const stage = (pr: number, files: ReturnType<typeof row>[], extra = {}) => ({ pr, head: "h", base: "b", files, ...extra });
  const board = (stages: ReturnType<typeof stage>[], clashes: any[] = []) => ({ main: "m", at: "", stages, written: [], skipped: [], clashes });
  test("waves, holds and what waits behind a hold", () => {
    const v = decide(board([
      stage(1, [row("a", "certain")]),
      stage(2, [row("a", "certain", [1])]),
      stage(3, [row("b", "card")]),
      stage(4, [row("b", "certain", [3])]),
      stage(5, [row("c", "certain")], { stackedOn: 9 }),
      stage(6, [row("d", "certain")]),
    ], [{ kind: "migration", key: "1", prs: [6] }]), []);
    const by = Object.fromEntries(v.map((x) => [x.pr, x]));
    expect([by[1]!.go, by[1]!.wave]).toEqual([true, 1]);
    expect([by[2]!.go, by[2]!.wave]).toEqual([true, 2]);
    expect(by[3]!.why).toContain("asks on b");
    expect(by[4]!.why).toContain("behind held #3");
    expect(by[5]!.why).toContain("stacked on #9");
    expect(by[6]!.why).toContain("migration");
  });
  test("a failed CI holds the PR", () => {
    const prs: BoardPr[] = [{ number: 1, headRefOid: "h", statusCheckRollup: [{ name: "apps", conclusion: "FAILURE", status: "COMPLETED" }] }];
    expect(decide(board([stage(1, [row("a", "certain")])]), prs)[0]!.why).toBe("CI failed: apps");
  });
});

import { buildStack, stackable } from "../scripts/mervin-merge.ts";
describe("mervin stack", () => {
  test("clean PRs join as merge commits, a clashing one is left out, only certain/agree are picked", () => {
    const repo = mkdtempSync(join(tmpdir(), "mervin-stack-"));
    const g = (...a: string[]) => { const r = Bun.spawnSync(["git", ...a], { cwd: repo, stderr: "pipe" }); return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }; };
    const put = (f: string, t: string, m: string) => { writeFileSync(join(repo, f), t); g("add", "-A"); g("commit", "-qm", m); return g("rev-parse", "HEAD").out.trim(); };
    g("init", "-q", "-b", "main"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
    const base = put("a.txt", "1\n2\n3\n", "base"); put("b.txt", "x\n", "b");
    const m = g("rev-parse", "HEAD").out.trim();
    g("checkout", "-qb", "q1", m); const h1 = put("a.txt", "one\n2\n3\n", "q1");
    g("checkout", "-qb", "q2", m); const h2 = put("c.txt", "new\n", "q2");
    g("checkout", "-qb", "q3", m); const h3 = put("a.txt", "uno\n2\n3\n", "q3");
    const mk = (n: number, h: string) => ({ number: n, headRefOid: h, title: `pr ${n}` });
    const r = buildStack(g, m, [mk(1, h1), mk(2, h2), mk(3, h3)], new Map([[1, "pr 1"], [2, "pr 2"], [3, "pr 3"]]));
    expect(r.joined).toEqual([1, 2]);
    expect(r.left.map((l) => l.pr)).toEqual([3]);
    expect(g("log", "--merges", "--format=%s", r.tip).out.trim().split("\n")).toEqual(["Merge #2: pr 2", "Merge #1: pr 1"]);
    expect(base).toBeTruthy();
    const row = (tier: any) => ({ path: "p", tier, why: "", after: [] });
    const board = { main: "m", at: "", skipped: [], clashes: [], written: [], stages: [{ pr: 1, head: "", base: "", files: [row("certain")] }, { pr: 2, head: "", base: "", files: [row("mervin")] }] };
    expect(stackable(board as any, [{ pr: 1, go: true, why: "", behind: [] }, { pr: 2, go: true, why: "", behind: [] }])).toEqual([1]);
  });
});
