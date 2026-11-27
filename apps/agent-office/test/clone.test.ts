import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fillWorktree } from "../live/clone.ts";

test("a new worktree takes the floor checkout's files, and git writes the ones it has edited or lacks", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "rb-clone-"));
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdio: "pipe" }).toString();
  git(repo, "init", "-q", "-b", "main");
  for (const f of ["same.txt", "edited.txt", "later.txt"]) writeFileSync(path.join(repo, f), `${f}\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "a");
  git(repo, "branch", "base");
  git(repo, "rm", "-q", "later.txt"); // the floor checkout has moved off the branch the worktree starts from
  git(repo, "commit", "-qm", "b");
  writeFileSync(path.join(repo, "edited.txt"), "work in progress\n");
  const old = new Date("2020-01-01T00:00:00Z");
  utimesSync(path.join(repo, "same.txt"), old, old);

  const tree = path.join(repo, "tree");
  git(repo, "worktree", "add", "-q", "--no-checkout", "-b", "office/x", tree, "base");
  const cloned = fillWorktree(repo, tree);

  expect(git(tree, "status", "--porcelain")).toBe("");
  expect(readFileSync(path.join(tree, "edited.txt"), "utf8")).toBe("edited.txt\n");
  expect(readFileSync(path.join(tree, "later.txt"), "utf8")).toBe("later.txt\n");
  if (process.platform !== "darwin") return; // a disk that can't clone: git wrote everything, checked above
  expect(cloned).toBe(2);
  expect(statSync(path.join(tree, "same.txt")).mtime).toEqual(old); // a clone keeps its source's times
});
