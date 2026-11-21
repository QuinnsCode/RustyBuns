import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { catchUp } from "./launchd.ts";

const git = (cwd: string, ...a: string[]) =>
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();

test("a job's detached checkout moves to a newer main; a branch or a dirty tree stays put", () => {
  const root = mkdtempSync(path.join(tmpdir(), "catchup-"));
  const origin = path.join(root, "origin");
  git(root, "init", "-q", "-b", "main", origin);
  writeFileSync(path.join(origin, "page.ts"), "old");
  git(origin, "add", ".");
  git(origin, "commit", "-qm", "one");
  const job = path.join(root, "job"), mine = path.join(root, "mine");
  git(root, "clone", "-q", origin, job);
  git(job, "checkout", "-q", "--detach");
  git(root, "clone", "-q", origin, mine);
  expect(catchUp(job)).toBe("current");

  writeFileSync(path.join(origin, "page.ts"), "new");
  git(origin, "commit", "-qam", "two");
  const main = git(origin, "rev-parse", "HEAD");

  expect(catchUp(mine)).toBe("skipped");
  expect(git(mine, "rev-parse", "HEAD")).not.toBe(main);

  writeFileSync(path.join(job, "page.ts"), "hand edit");
  expect(catchUp(job)).toBe("skipped");
  git(job, "checkout", "-q", "--", "page.ts");

  expect(catchUp(job)).toBe("moved");
  expect(git(job, "rev-parse", "HEAD")).toBe(main);
  expect(catchUp(job)).toBe("current");
});
