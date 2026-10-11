import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheCopy } from "../src/index.ts";

test("a planted library in the cache is overwritten with the embedded bytes", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "rb-native-"));
  const bytes = new TextEncoder().encode("the real library");
  const out = cacheCopy(bytes, "libdemo.dylib", { cacheDir });
  expect(readFileSync(out, "utf8")).toBe("the real library");
  writeFileSync(out, "a planted library");
  expect(cacheCopy(bytes, "libdemo.dylib", { cacheDir })).toBe(out);
  expect(readFileSync(out, "utf8")).toBe("the real library");
});
