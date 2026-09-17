// The shell drives SuperSplat through window.scene.events ("import",
// "scene.dirty"). That's internal to SuperSplat, so check the pinned
// checkout still has it. Skips until `bun run editor` has fetched it.
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dir, "..", ".vendor", "supersplat", "src");
const hasVendor = existsSync(src);
if (!hasVendor) console.warn("[splat-desktop] SuperSplat not fetched: skipping editor hook checks. Run `bun run editor`.");
const withEditor = test.skipIf(!hasVendor);
const read = (f: string) => readFileSync(join(src, f), "utf8");

withEditor("SuperSplat still exposes window.scene", () => {
  expect(read("main.ts")).toMatch(/window\.scene\s*=\s*scene/);
  expect(read("scene.ts")).toMatch(/\bevents:\s*Events/);
});

withEditor("the events the shell calls still exist", () => {
  expect(read("file-handler.ts")).toMatch(/events\.function\('import',\s*\(files: ImportFile\[\]/);
  expect(read("file-handler.ts")).toMatch(/url\?: string/);
  expect(read("main.ts")).toContain("url.searchParams.getAll('load')");
  expect(read("main.ts")).toContain("decodeURIComponent(value)");
  const all = ["doc.ts", "editor.ts", "scene.ts", "main.ts", "file-handler.ts"].map(read).join("\n");
  expect(all).toMatch(/events\.function\('scene\.dirty'/);
});
