import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backoff, fingerprint, watched } from "../scripts/mama.ts";

test("mama watches the bun binary, the lockfile, package.json and the pinned release", () => {
  const files = watched(process.execPath);
  expect(files[0]).toBe(process.execPath);
  expect(files.map((f) => path.basename(f))).toEqual([path.basename(process.execPath), "bun.lock", "package.json", "release.ts"]);
});

test("a rewritten file, or one that appears, changes the fingerprint", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mama-"));
  const lock = path.join(dir, "bun.lock");
  const before = fingerprint([lock]);
  writeFileSync(lock, "a");
  const made = fingerprint([lock]);
  expect(made).not.toBe(before);
  expect(fingerprint([lock])).toBe(made);
  writeFileSync(lock, "ab");
  expect(fingerprint([lock])).not.toBe(made);
});

test("an office that keeps dying waits longer each time, up to 30s", () => {
  expect([1, 2, 3, 4, 5, 6, 7].map(backoff)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});
