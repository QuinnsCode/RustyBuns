import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { catchUp, jobCheckout } from "./launchd.ts";

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

test("a job's checkout is a worktree of the clone it was asked for; one of another clone says how to move it", () => {
  const root = mkdtempSync(path.join(tmpdir(), "jobcheckout-"));
  const origin = path.join(root, "origin"), state = path.join(root, "state"), office = path.join(root, "office");
  git(root, "init", "-q", "-b", "main", origin);
  writeFileSync(path.join(origin, "page.ts"), "one");
  git(origin, "add", ".");
  git(origin, "commit", "-qm", "one");
  git(root, "clone", "-q", origin, state);
  git(root, "clone", "-q", origin, office);
  const home = path.join(root, "job", "rustybuns");
  const common = (cwd: string) => realpathSync(git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"));

  expect(jobCheckout(office, home)).toBe(home);
  expect(common(home)).toBe(common(office));
  expect(() => jobCheckout(state, home)).toThrow(`worktree remove ${home}`);

  git(root, `--git-dir=${common(office)}`, "worktree", "remove", home);
  expect(jobCheckout(state, home)).toBe(home);
  expect(common(home)).toBe(common(state));
  expect(jobCheckout(state, home)).toBe(home);
});
