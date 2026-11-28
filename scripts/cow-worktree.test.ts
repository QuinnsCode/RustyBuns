import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { add, dedupe } from "./cow-worktree.ts";

const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdio: "pipe" }).toString();

// cloning needs APFS, which CI's Linux runners don't have
test.skipIf(process.platform !== "darwin")("dedupe shares an idle worktree's unchanged files and leaves edited files and a busy worktree alone", () => {
  const top = realpathSync(mkdtempSync(path.join(tmpdir(), "rb-cow-")));
  const repo = path.join(top, "main");
  git(top, "init", "-q", "-b", "main", repo);
  writeFileSync(path.join(repo, "asset.bin"), "x".repeat(200_000));
  writeFileSync(path.join(repo, "edited.bin"), "y".repeat(200_000));
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "a");
  const [idle, dirty, busy] = ["idle", "dirty", "busy"].map((n) => path.join(top, n)) as [string, string, string];
  for (const t of [idle, dirty, busy]) git(repo, "worktree", "add", "-q", "--detach", t);
  writeFileSync(path.join(dirty, "new.txt"), "work\n");
  writeFileSync(path.join(dirty, "edited.bin"), "my change\n");
  const work = git(dirty, "status", "--porcelain");
  const old = new Date("2020-01-01T00:00:00Z");
  utimesSync(path.join(repo, "asset.bin"), old, old);
  const inUse = () => [busy];

  const before = statSync(path.join(idle, "asset.bin")).mtime;
  const plan = dedupe(repo, false, inUse);
  expect(plan.map((t) => [path.basename(t.path), t.files, t.skipped]).sort()).toEqual([["busy", 0, "in use"], ["dirty", 1, undefined], ["idle", 2, undefined]]);
  expect(statSync(path.join(idle, "asset.bin")).mtime).toEqual(before); // a dry run changes nothing

  expect(dedupe(repo, false, inUse, [path.join(top, "elsewhere")])).toEqual([]); // --under leaves the rest out

  dedupe(repo, true, inUse);
  expect(statSync(path.join(idle, "asset.bin")).mtime).toEqual(old); // now the donor's clone
  expect(git(idle, "status", "--porcelain")).toBe("");
  expect(statSync(path.join(dirty, "asset.bin")).mtime).toEqual(old); // a dirty worktree's unchanged file is shared too
  expect(readFileSync(path.join(dirty, "edited.bin"), "utf8")).toBe("my change\n");
  expect(git(dirty, "status", "--porcelain")).toBe(work);
  expect(dedupe(repo, false, inUse).find((t) => t.path === idle)?.files).toBe(0); // nothing left to give back

  const made = path.join(top, "made");
  expect(add(repo, made, "main")).toBe(2);
  expect(readFileSync(path.join(made, "asset.bin"), "utf8")).toHaveLength(200_000);
});

test("add refuses a donor with uncommitted changes", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "rb-cow-dirty-"));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(path.join(repo, "a.txt"), "a\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "a");
  writeFileSync(path.join(repo, "a.txt"), "changed\n");
  expect(() => add(repo, `${repo}-tree`, "main")).toThrow("uncommitted changes");
});
