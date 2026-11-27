import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fingerprint } from "../scripts/mama.ts";

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
