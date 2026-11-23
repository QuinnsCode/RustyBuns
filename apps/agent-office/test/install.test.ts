import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { adoptModules, installWorktree, needsInstall, poolModules } from "../live/install.ts";

const dir = (files: string[]) => {
  const d = mkdtempSync(path.join(tmpdir(), "rb-install-"));
  for (const f of files) f.endsWith("/") ? mkdirSync(path.join(d, f)) : writeFileSync(path.join(d, f), "");
  return d;
};

test("only a Bun checkout without node_modules needs the install", () => {
  expect(needsInstall(dir(["bun.lock"]))).toBe(true);
  expect(needsInstall(dir(["bun.lock", "node_modules/"]))).toBe(false);
  expect(needsInstall(dir(["README.md"]))).toBe(false);
});

test("the install runs in the worktree and a failure or hang is reported, not thrown", async () => {
  const d = dir(["bun.lock"]);
  expect(await installWorktree(d, 5000, ["sh", "-c", "mkdir node_modules"])).toBe("");
  expect(needsInstall(d)).toBe(false);
  expect(await installWorktree(dir(["bun.lock"]), 5000, ["sh", "-c", "exit 3"])).toBe("bun install exited 3");
  expect(await installWorktree(dir(["bun.lock"]), 5000, ["no-such-command-rb"])).not.toBe("");
  expect(await installWorktree(dir(["bun.lock"]), 100, ["sleep", "5"])).toMatch(/exited/);
});

// #5656: a send-home pools its node_modules and the next hire takes it, so neither writes nor deletes ~250k files
test("a worktree on its way out pools its node_modules, the next hire takes it, and the pool keeps two of the newest lockfile", async () => {
  const repo = mkdtempSync(path.join(tmpdir(), "rb-pool-"));
  const tree = (name: string, lock = "v1") => {
    const d = path.join(repo, ".agent-office/worktrees", name);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "bun.lock"), lock);
    return d;
  };
  const leaving = (name: string, lock = "v1") => {
    const d = tree(name, lock);
    mkdirSync(path.join(d, "node_modules/effect"), { recursive: true });
    writeFileSync(path.join(d, "node_modules/effect/from"), name);
    return d;
  };
  const pool = path.join(repo, ".agent-office/node-pool");
  const pooled = () => readdirSync(pool).filter((n) => !n.startsWith("gone-"));

  expect(await poolModules(leaving("gizmo-1"), 1)).toBe(true);
  expect(existsSync(path.join(repo, ".agent-office/worktrees/gizmo-1/node_modules"))).toBe(false);
  // the install runs with the pooled copy already in place
  const hire = tree("bolt-2");
  expect(await installWorktree(hire, 5000, ["sh", "-c", "test -f node_modules/effect/from"])).toBe("");
  expect(readFileSync(path.join(hire, "node_modules/effect/from"), "utf8")).toBe("gizmo-1");
  expect(pooled()).toEqual([]);

  // a third copy pushes out the oldest; a new lockfile drops the old ones; a hire with an older lockfile still takes one
  for (const [i, n] of ["a-1", "b-2", "c-3"].entries()) await poolModules(leaving(n), 10 + i);
  expect(pooled().length).toBe(2);
  await poolModules(leaving("d-4", "v2"), 20);
  expect(pooled().length).toBe(1);
  expect(await adoptModules(tree("e-5"))).toBe(true);
  expect(readFileSync(path.join(repo, ".agent-office/worktrees/e-5/node_modules/effect/from"), "utf8")).toBe("d-4");

  // a folder outside an office worktrees folder neither pools nor adopts
  expect(await poolModules(dir(["bun.lock", "node_modules/"]))).toBe(false);
});
