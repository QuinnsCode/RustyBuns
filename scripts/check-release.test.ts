import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRelease, PKGS, setVersion } from "./check-release.ts";

// What npm-publish.yml does on a `v` tag pushed on the soaked commit (#4528): the repo's own package files, set to the
// tag's version, agree with each other, so bun pm pack turns workspace:* into that version.
test("a tag's version, set at pack time, lands in every package, bun.lock and the README", () => {
  const root = mkdtempSync(join(tmpdir(), "check-release-"));
  for (const p of PKGS) mkdirSync(join(root, "packages", p), { recursive: true });
  for (const p of PKGS) cpSync(`packages/${p}/package.json`, join(root, "packages", p, "package.json"));
  for (const f of ["bun.lock", "README.md"]) cpSync(f, join(root, f));

  expect(checkRelease(root).bad).toEqual([]);
  setVersion("9.8.7", root);
  expect(checkRelease(root)).toEqual({ version: "9.8.7", bad: [] });
  expect(readFileSync(join(root, "packages/cli/package.json"), "utf8")).toContain(`"version": "9.8.7"`);

  expect(() => setVersion("v9.8.8", root)).toThrow();
  expect(checkRelease(root).version).toBe("9.8.7");
});
