import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spaFallback } from "../src/spa-fallback.ts";

const dist = (redirects?: string) => {
  const d = mkdtempSync(join(tmpdir(), "spa-"));
  if (redirects !== undefined) writeFileSync(join(d, "_redirects"), redirects);
  return d;
};

test("spaFallback: a Pages app's catch-all becomes SPA mode and the other rules stay", () => {
  const r = spaFallback(dist("/docs/* /docs/:splat 200\n/* /index.html 200\n"));
  expect(r.notFoundHandling).toBe("single-page-application");
  expect(r.redirects).toBe("/docs/* /docs/:splat 200\n");
});

test.each([
  ["no _redirects", undefined],
  ["only real redirects", "/old /new 301\n"],
  ["a rewrite that isn't the catch-all", "/app/* /app/index.html 200\n"],
])("spaFallback: %s changes nothing", (_, text) => {
  expect(spaFallback(dist(text))).toEqual({});
});
