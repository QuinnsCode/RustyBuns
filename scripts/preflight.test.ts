import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../apps/codesplitter/scripts/mervin-board.ts";
import { ME, OpenPr, overlaps, verdict } from "./preflight.ts";

const SHA = "a".repeat(40);
const pr = (number: number, headRefName: string, ...files: string[]): OpenPr => ({ number, title: `t${number}`, headRefName, headRefOid: SHA, files: files.map((path) => ({ path })) });

test("open PRs sharing a file are listed, most shared first; generated-only and your own PR are not clashes", () => {
  const prs = [
    pr(1, "a", "x.ts"),
    pr(2, "b", "x.ts", "y.ts"),
    pr(3, "c", "bun.lock", "z.ts"),
    pr(4, "me", "x.ts", "y.ts"),
    pr(5, "d", "unrelated.ts"),
  ];
  const r = overlaps(["x.ts", "y.ts", "bun.lock"], prs, "me");
  expect(r.clash.map((o) => o.pr)).toEqual([2, 1]);
  expect(r.generated.map((o) => o.pr)).toEqual([3]);
});

test("a gh row without its files list is refused, not read as no files", () => {
  expect(() => OpenPr({ number: 7, title: "t", headRefName: "b", headRefOid: SHA })).toThrow("files");
});

test("Mervin merges your branch after the open PR: same line is a card, a different stretch merges clean", () => {
  const dir = mkdtempSync(join(tmpdir(), "preflight-"));
  try {
    const git = (...a: string[]) => {
      const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir });
      if (r.exitCode !== 0) throw new Error(r.stderr.toString());
      return r.stdout.toString().trim();
    };
    const commit = (files: Record<string, string>) => {
      for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t);
      git("add", "-A"); git("commit", "-qm", "c");
      return git("rev-parse", "HEAD");
    };
    const lines = (n: number, at: Record<number, string> = {}) => Array.from({ length: n }, (_, i) => at[i] ?? `line ${i}`).join("\n") + "\n";
    git("init", "-q", "-b", "main");
    const main = commit({ "a.ts": lines(20), "b.ts": lines(20) });
    const theirs = commit({ "a.ts": lines(20, { 2: "theirs" }), "b.ts": lines(20, { 2: "theirs" }) });
    git("checkout", "-q", main);
    const mine = commit({ "a.ts": lines(20, { 2: "mine" }), "b.ts": lines(20, { 17: "mine" }) });
    const v = verdict(run(dir, main, [
      { number: 9, title: "theirs", headRefOid: theirs, headRefName: "theirs" },
      { number: ME, title: "this branch", headRefOid: mine, headRefName: "me" },
    ]).board);
    expect(v.cards.map((f) => [f.path, f.after])).toEqual([["a.ts", [9]]]);
    expect([...v.settles, ...v.look]).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
