import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { report } from "../scripts/mervin-try.ts";

const sh = (dir: string, cmd: string) => {
  const r = Bun.spawnSync(["sh", "-c", cmd], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (r.exitCode > 1) throw new Error(r.stderr.toString());
};
const put = (dir: string, text: string, msg: string) => { writeFileSync(join(dir, "list.txt"), text); sh(dir, `git add -A && git commit -qm '${msg}'`); };

test("a history with no merge commits says there is nothing to score", () => {
  const dir = mkdtempSync(join(tmpdir(), "mervin-try-"));
  sh(dir, "git init -q -b main");
  put(dir, "a\n", "one");
  expect(report(dir)).toContain("No merge commits");
});

test("a conflict the person settled the way Mervin does is reported as settled", () => {
  const dir = mkdtempSync(join(tmpdir(), "mervin-try-"));
  sh(dir, "git init -q -b main");
  put(dir, "a\nb\nc\n", "base");
  sh(dir, "git checkout -qb pr");
  put(dir, "a\nb\nbranch\nc\n", "pr");
  sh(dir, "git checkout -q main");
  put(dir, "a\nb\nmain\nc\n", "main");
  sh(dir, "git merge --no-ff -q pr -m 'Merge pr' || true");
  put(dir, "a\nb\nmain\nbranch\nc\n", "Merge pr");
  expect(report(dir)).toContain("1 of those 1 merges (100%) would have needed no person");
});
