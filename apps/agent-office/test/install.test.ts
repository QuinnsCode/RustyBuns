import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { installWorktree, needsInstall } from "../live/install.ts";

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
