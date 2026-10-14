import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { score, tally } from "../scripts/mervin-score.ts";

const sh = (dir: string, cmd: string) => {
  const r = Bun.spawnSync(["sh", "-c", cmd], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (r.exitCode > 1) throw new Error(r.stderr.toString());
};
let tick = 0;
const put = (dir: string, file: string, text: string, msg: string) => {
  writeFileSync(join(dir, file), text);
  const d = `2026-01-01T00:00:${String(++tick).padStart(2, "0")}Z`;
  sh(dir, `git add -A && GIT_COMMITTER_DATE=${d} GIT_AUTHOR_DATE=${d} git commit -qm '${msg}'`);
};

test("a branch that edited the same line main did is flagged at its midpoint and fights at merge", () => {
  const dir = mkdtempSync(join(tmpdir(), "mervin-"));
  sh(dir, "git init -q -b main");
  put(dir, "a.txt", "one\ntwo\nthree\n", "base");
  sh(dir, "git checkout -qb pr");
  sh(dir, "git checkout -q main");
  put(dir, "a.txt", "one\nMAIN\nthree\n", "main edit");
  sh(dir, "git checkout -q pr");
  put(dir, "a.txt", "one\nPR\nthree\n", "pr 1");
  put(dir, "b.txt", "x\n", "pr 2");
  put(dir, "c.txt", "y\n", "pr 3");
  sh(dir, "git checkout -q main");
  sh(dir, "git merge --no-ff -q pr -m 'Merge pr' || true");
  sh(dir, "git checkout --theirs . && git add -A && git commit -qm 'Merge pr'");
  const cases = score(dir);
  expect(cases).toHaveLength(1);
  expect(cases[0].fought).toBe(true);
  expect(tally(cases, "overlap").recall).toBe(1);
  expect(cases[0].lines).toBe(true);
  expect(tally(cases, "lines").recall).toBe(1);
});

test("the line-id predictor stays quiet when both sides touched a file in different places", () => {
  const dir = mkdtempSync(join(tmpdir(), "mervin-"));
  sh(dir, "git init -q -b main");
  put(dir, "a.txt", "one\ntwo\nthree\nfour\nfive\nsix\nseven\n", "base");
  sh(dir, "git checkout -qb pr");
  sh(dir, "git checkout -q main");
  put(dir, "a.txt", "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\n", "main edit");
  sh(dir, "git checkout -q pr");
  put(dir, "a.txt", "one\ntwo\nthree\nfour\nfive\nsix\nSEVEN\n", "pr 1");
  put(dir, "b.txt", "x\n", "pr 2");
  put(dir, "c.txt", "y\n", "pr 3");
  sh(dir, "git checkout -q main");
  sh(dir, "git merge --no-ff -q pr -m 'Merge pr'");
  const cases = score(dir);
  expect(cases).toHaveLength(1);
  expect(cases[0].overlap).toBe(true);
  expect(cases[0].lines).toBe(false);
});
