import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { order, run, score, type BoardPr } from "../scripts/mervin-board.ts";

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

  test("a PR not landed yet is waiting, not scored", () => {
    const { board } = run(repo, main, order(prs, [1]));
    mkdirSync(join(repo, "none"), { recursive: true });
    expect(score(repo, board, join(repo, "none"), main).rows.every((r) => r.score === "waiting")).toBe(true);
  });
});
