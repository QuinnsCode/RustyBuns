import { expect, test } from "bun:test";
import { isBuildFile } from "../src/buildfiles.ts";
import { isLockfile, LOCKFILES, LOCK_PM } from "../src/lockfiles.ts";

test("one lockfile list feeds the build-file review and the package manager lookup", () => {
  for (const name of LOCKFILES) expect(isBuildFile(`apps/a/${name}`)).toBe(true);
  for (const name of Object.keys(LOCK_PM)) expect(LOCKFILES).toContain(name);
  expect(isLockfile("a/b/pnpm-lock.yaml")).toBe(true);
  expect(isLockfile("a/not-bun.lock.txt")).toBe(false);
});
