import { test, expect } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptNote, alchemyStage, linkSharedState, lockState, sharedStateBase, unlinkSharedState } from "../src/state.ts";

function repoWithWorktree() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rb-state-")));
  const main = join(root, "main");
  const sh = (cwd: string, ...cmd: string[]) => {
    const r = Bun.spawnSync(cmd, { cwd, stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  };
  mkdirSync(join(main, "apps", "game"), { recursive: true });
  writeFileSync(join(main, "apps", "game", "rustybuns.config.ts"), "");
  sh(main, "git", "init", "-q");
  sh(main, "git", "add", ".");
  sh(main, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  const wt = join(root, "wt");
  sh(main, "git", "worktree", "add", "-q", wt);
  return { root, sh, mainApp: join(main, "apps", "game"), wtApp: join(wt, "apps", "game"), wt, main };
}

test("shared state: one dir per app for the main checkout and every worktree, and it outlives the worktree", () => {
  const r = repoWithWorktree();
  const base = sharedStateBase(r.wtApp)!;
  expect(base).toBe(join(r.main, ".git", "rustybuns", "alchemy", "apps", "game"));
  expect(sharedStateBase(r.mainApp)).toBe(base);

  // State made in the worktree before this change moves to the shared dir.
  mkdirSync(join(r.wtApp, ".alchemy", "state", "game", "dev"), { recursive: true });
  writeFileSync(join(r.wtApp, ".alchemy", "state", "game", "dev", "Worker.json"), "{}");
  expect(linkSharedState(r.wtApp)).toBe(base);
  expect(lstatSync(join(r.wtApp, ".alchemy", "state")).isSymbolicLink()).toBe(true);
  expect(existsSync(join(base, "state", "game", "dev", "Worker.json"))).toBe(true);
  expect(linkSharedState(r.wtApp)).toBe(base); // idempotent

  r.sh(r.main, "git", "worktree", "remove", "--force", r.wt);
  expect(existsSync(join(base, "state", "game", "dev", "Worker.json"))).toBe(true);
  linkSharedState(r.mainApp);
  expect(existsSync(join(r.mainApp, ".alchemy", "state", "game", "dev", "Worker.json"))).toBe(true);

  unlinkSharedState(r.mainApp);
  expect(existsSync(join(r.mainApp, ".alchemy", "state"))).toBe(false);
  expect(existsSync(join(base, "state", "game", "dev", "Worker.json"))).toBe(true);
});

test("shared state: refuses to pick between a local state and a non-empty shared one", () => {
  const r = repoWithWorktree();
  mkdirSync(join(sharedStateBase(r.wtApp)!, "state", "game"), { recursive: true });
  mkdirSync(join(r.wtApp, ".alchemy", "state", "game"), { recursive: true });
  expect(() => linkSharedState(r.wtApp)).toThrow("both exist");
});

test("shared state: outside git it stays in the project", () => {
  expect(linkSharedState(realpathSync(mkdtempSync(join(tmpdir(), "rb-nogit-"))))).toBeNull();
});

test("state lock: held by a live process, taken over from a dead one", () => {
  const base = mkdtempSync(join(tmpdir(), "rb-lock-"));
  writeFileSync(join(base, "lock"), JSON.stringify({ pid: process.ppid, cwd: "/other/worktree", what: "deploy" }));
  expect(() => lockState(base, "plan")).toThrow("/other/worktree");

  const dead = Bun.spawnSync(["true"]).pid;
  writeFileSync(join(base, "lock"), JSON.stringify({ pid: dead, cwd: "/gone", what: "deploy" }));
  const release = lockState(base, "deploy");
  expect(JSON.parse(readFileSync(join(base, "lock"), "utf8")).pid).toBe(process.pid);
  release();
  expect(existsSync(join(base, "lock"))).toBe(false);
});

test("adopt note: names what a `create` takes over until the stage has state", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rb-adopt-")));
  const cfg = {
    name: "game",
    bindings: { DB: { type: "d1" as const, databaseName: "game-db" }, BUCKET: { type: "r2" as const, bucketName: "game-files" } },
    targets: { edge: { provider: "cloudflare" as const, adopt: true } },
  };
  const note = adoptNote(dir, cfg, "live_me")!;
  expect(note).toContain("stage live_me");
  expect(note).toContain("Worker game, D1 game-db, R2 game-files");
  expect(adoptNote(dir, { ...cfg, targets: { edge: { provider: "cloudflare" } } }, "live_me")).toBeNull();
  mkdirSync(join(dir, ".alchemy", "state", "game", "live_me"), { recursive: true });
  writeFileSync(join(dir, ".alchemy", "state", "game", "live_me", "Worker.json"), "{}");
  expect(adoptNote(dir, cfg, "live_me")).toBeNull();
  expect(adoptNote(dir, cfg, "pr_1")).not.toBeNull();
});

test("alchemy stage: --stage, then $ALCHEMY_STAGE, then live_$USER", () => {
  expect(alchemyStage(["--stage", "pr_1"], { USER: "me" })).toBe("pr_1");
  expect(alchemyStage(["--yes", "--stage=pr_2"], { USER: "me" })).toBe("pr_2");
  expect(alchemyStage([], { ALCHEMY_STAGE: "prod", USER: "me" })).toBe("prod");
  expect(alchemyStage([], { USER: "me" })).toBe("live_me");
});
