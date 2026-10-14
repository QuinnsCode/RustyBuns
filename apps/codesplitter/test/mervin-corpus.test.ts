import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bucket, run } from "../scripts/mervin-corpus.ts";

const sh = (dir: string, cmd: string) => {
  const r = Bun.spawnSync(["sh", "-c", cmd], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (r.exitCode > 1) throw new Error(r.stderr.toString());
};
const put = (dir: string, file: string, text: string, msg: string) => {
  writeFileSync(join(dir, file), text);
  sh(dir, `git add -A && git commit -qm '${msg}'`);
};

test("a merge git conflicted on is replayed, and the fight Mervin settles the way the person did counts as solved", () => {
  const dir = mkdtempSync(join(tmpdir(), "mervin-corpus-"));
  sh(dir, "git init -q -b main");
  put(dir, "list.txt", "a\nb\nc\n", "base");
  sh(dir, "git checkout -qb pr");
  put(dir, "list.txt", "a\nb\nbranch\nc\n", "pr adds after b");
  sh(dir, "git checkout -q main");
  put(dir, "list.txt", "a\nb\nmain\nc\n", "main adds after b");
  // Two lines added at one spot: git conflicts; the person kept both, main's first.
  sh(dir, "git merge --no-ff -q pr -m 'Merge pr' || true");
  writeFileSync(join(dir, "list.txt"), "a\nb\nmain\nbranch\nc\n");
  sh(dir, "git add -A && git commit -qm 'Merge pr'");
  const { fought, rows } = run(dir);
  expect(fought).toBe(1);
  expect(rows).toHaveLength(1);
  expect(["solved", "close"]).toContain(rows[0]!.bucket);
});

test("a settled-but-different merge is wrong, a clean-in-git one Mervin refuses is a gap", () => {
  expect(bucket("git-only", false, true, false, false)).toBe("wrong");
  expect(bucket("git-only", false, true, true, false)).toBe("solved");
  expect(bucket("git-only", false, true, false, true)).toBe("close");
  expect(bucket("both", false, false, false, false)).toBe("cards");
  expect(bucket("ours-only", true, false, false, false)).toBe("gap");
});
