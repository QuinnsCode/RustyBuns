import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetIgnore, stageAssets } from "../src/stage-assets.ts";

test("stageAssets: a binary carries the page's files, not source maps, .assetsignore's or an earlier binary", () => {
  const src = mkdtempSync(join(tmpdir(), "rb-assets-")), dest = join(mkdtempSync(join(tmpdir(), "rb-embed-")), "dist");
  const files: Record<string, string> = {
    "index.html": "", "assets/main.js": "", "assets/main.js.map": "", "assets/main.css": "",
    "drafts/a.html": "", "notes.md": "", "docs/notes.md": "", "keep/notes.md": "",
    "app-darwin-arm64": "", "app-windows-x64.exe": "", "app-darwin-arm64.txt": "",
    ".assetsignore": "# comments and blanks are skipped\n\ndrafts/\n*.md\n!/keep/notes.md\n",
  };
  for (const [f, c] of Object.entries(files)) { mkdirSync(join(src, f, ".."), { recursive: true }); writeFileSync(join(src, f), c); }
  const s = stageAssets(src, dest, { binaryPrefix: "app-" });
  const staged = (readdirSync(dest, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
    .filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(dest.length + 1)).sort();
  expect(staged).toEqual(["app-darwin-arm64.txt", "assets/main.css", "assets/main.js", "index.html", "keep/notes.md"]);
  expect(s).toEqual({ files: 5, maps: 1, ignored: 3, binaries: 2 });
  expect(stageAssets(src, dest, { keepMaps: true, binaryPrefix: "app-" }).maps).toBe(0);
});

test("assetIgnore: gitignore's anchoring, ** and directory rules", () => {
  const ig = assetIgnore("/top.txt\nsub/*.log\n**/cache/\nbuild/**/*.tmp\n");
  expect(["top.txt", "x/top.txt"].map(ig)).toEqual([true, false]);
  expect(["sub/a.log", "sub/x/a.log", "other/sub/a.log"].map(ig)).toEqual([true, false, false]);
  expect(["cache/x", "a/b/cache/y", "cache"].map(ig)).toEqual([true, true, false]);
  expect(["build/a.tmp", "build/x/y/a.tmp"].map(ig)).toEqual([true, true]);
});
