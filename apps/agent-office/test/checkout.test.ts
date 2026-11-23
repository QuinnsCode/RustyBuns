// #5523: `git worktree add` on a 10,000-file repo outran upstream's 20 s timeout, and the error was git's progress line.
import { expect, setDefaultTimeout } from "bun:test";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CHECKOUT_TIMEOUT_MS, slowCheckout, startFromDefault } from "../scripts/checkout.ts";
import { beforePinned, pinnedTest, unpackPinned } from "./pinned.ts";

// the first run downloads the pinned release into .cache, as rustybunsify.ts does
setDefaultTimeout(60_000);

let file = "";
let mod: { Worktrees: new (dir: string) => { create(slug: string): unknown; gitSync(a: string[]): string }; gitError(e: unknown): string };
beforePinned(async () => {
  file = path.join(await unpackPinned(), "dist/server/server/worktrees.js");
  writeFileSync(file, startFromDefault(slowCheckout(readFileSync(file, "utf8"))));
  mod = await import(file);
});

pinnedTest("worktree add gets the long timeout, other git calls keep theirs", () => {
  const js = readFileSync(file, "utf8");
  expect(js.split(`args[1] === 'add' ? ${CHECKOUT_TIMEOUT_MS} : 20_000`).length).toBe(2);
  expect(js.split(`args[1] === 'add' ? ${CHECKOUT_TIMEOUT_MS} : 60_000`).length).toBe(2);
});

pinnedTest("a hire still makes its worktree", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "rb-checkout-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(repo, "a.txt"), "a\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
  const made = new mod.Worktrees(repo).create("sprocket-1");
  expect(made).toMatchObject({ branch: "office/sprocket-1" });
  expect(readFileSync(path.join(repo, ".agent-office/worktrees/sprocket-1/a.txt"), "utf8")).toBe("a\n");
});

pinnedTest("a git the office stopped says it ran out of time, not its last progress line", async () => {
  let sync: unknown;
  try {
    execFileSync("sh", ["-c", "echo 'Updating files:  45% (4500/10003)' >&2; sleep 5"], { timeout: 200, stdio: "pipe" });
  } catch (e) {
    sync = e;
  }
  expect(mod.gitError(sync)).toBe("git ran out of time and was stopped");
  const late = await new Promise((done) => execFile("sleep", ["5"], { timeout: 200 }, done));
  expect(mod.gitError(late)).toBe("git ran out of time and was stopped");
  expect(mod.gitError({ stderr: "fatal: a branch named 'x' already exists\n" })).toBe("fatal: a branch named 'x' already exists");
});

// The floor checkout was left on a squash-merged branch: origin's copy of it is that PR's last commit, and main moved on.
pinnedTest("a hire starts from origin/main even when the floor checkout is on an old merged branch", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "rb-base-"));
  const run = (cwd: string, ...a: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdio: "pipe" }).toString().trim();
  const origin = path.join(tmp, "origin.git");
  const repo = path.join(tmp, "floor");
  run(tmp, "init", "-q", "--bare", "-b", "main", origin);
  run(tmp, "clone", "-q", origin, repo);
  const commit = (text: string) => {
    writeFileSync(path.join(repo, "a.txt"), text);
    run(repo, "add", ".");
    run(repo, "commit", "-qm", text);
  };
  commit("a\n");
  run(repo, "push", "-q", "origin", "main");
  run(repo, "checkout", "-qb", "old-feature");
  commit("feature\n");
  run(repo, "push", "-q", "origin", "old-feature");
  run(repo, "checkout", "-q", "main");
  commit("merged later\n");
  run(repo, "push", "-q", "origin", "main");
  run(repo, "remote", "set-head", "origin", "main");
  run(repo, "checkout", "-q", "old-feature");
  run(repo, "reset", "-q", "--hard", "origin/main");
  const made = new mod.Worktrees(repo).create("sprocket-2");
  expect(made).toMatchObject({ from: "main", base: run(repo, "rev-parse", "origin/main") });
  expect(readFileSync(path.join(repo, ".agent-office/worktrees/sprocket-2/a.txt"), "utf8")).toBe("merged later\n");
});
