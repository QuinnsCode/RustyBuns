import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { tidySourceMaps } from "../src/sourcemaps.ts";

test("names each map's module and makes its sources app-relative, as wrangler does", () => {
  const app = mkdtempSync(join(tmpdir(), "rb-maps-"));
  mkdirSync(join(app, "dist/worker/chunks"), { recursive: true });
  writeFileSync(join(app, "dist/worker/worker.js"), "x\n//# sourceMappingURL=worker.js.map\n");
  // Bun writes sources relative to the map, through the absolute path: ../../../../Users/…/src/a.ts
  const up = relative(join(app, "dist/worker"), "/");
  writeFileSync(join(app, "dist/worker/worker.js.map"), JSON.stringify({
    version: 3, sources: [`${up}${app}/src/branches.ts`, "../../node_modules/x/index.js", "webpack://pkg/y.js"],
    sourcesContent: ["a", "b", "c"], mappings: "AAAA", names: [],
  }));
  writeFileSync(join(app, "dist/worker/chunks/c.js.map"), JSON.stringify({ version: 3, sourceRoot: "../../..", sources: ["src/c.ts"], mappings: "" }));
  writeFileSync(join(app, "dist/worker/not-a-map.txt"), "");

  expect(tidySourceMaps(app, "dist/worker/worker.js")).toEqual(["chunks/c.js.map", "worker.js.map"]);
  const main = JSON.parse(readFileSync(join(app, "dist/worker/worker.js.map"), "utf8"));
  expect(main.file).toBe("worker.js");
  expect(main.sources).toEqual(["src/branches.ts", "node_modules/x/index.js", "webpack://pkg/y.js"]);
  expect(main.sourcesContent).toEqual(["a", "b", "c"]);
  const chunk = JSON.parse(readFileSync(join(app, "dist/worker/chunks/c.js.map"), "utf8"));
  expect(chunk.file).toBe("chunks/c.js");
  expect(chunk.sources).toEqual(["src/c.ts"]);
  expect(chunk.sourceRoot).toBeUndefined();
});

test("no build output, nothing to do", () => {
  expect(tidySourceMaps(mkdtempSync(join(tmpdir(), "rb-maps-")), "dist/worker/worker.js")).toEqual([]);
});
