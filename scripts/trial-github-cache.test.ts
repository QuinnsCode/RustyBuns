import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache, cacheKey, DAY, overBudget, parseRate, rateLine } from "./trial-github-cache.ts";

test("cache keys: readable, stable, and apart for any differing part", () => {
  const k = cacheKey("pkg", "owner/repo", "apps/web", "2026-10-01T12:00:00Z");
  expect(k).toMatch(/^pkg\/owner_repo_apps_web_2026-10-01T12_00_00Z-[0-9a-f]{12}\.json$/);
  expect(cacheKey("pkg", "owner/repo", "apps/web", "2026-10-01T12:00:00Z")).toBe(k);
  // a new push, another subdir, another kind: another file
  expect(cacheKey("pkg", "owner/repo", "apps/web", "2026-10-02T12:00:00Z")).not.toBe(k);
  expect(cacheKey("pkg", "owner/repo", "apps/api", "2026-10-01T12:00:00Z")).not.toBe(k);
  expect(cacheKey("meta", "owner/repo", "apps/web", "2026-10-01T12:00:00Z").startsWith("meta/")).toBe(true);
  // parts that slug the same still hash apart
  expect(cacheKey("pkg", "a/b", "c")).not.toBe(cacheKey("pkg", "a", "b/c"));
  expect(cacheKey("search", '"rwsdk" filename:package.json', 1)).not.toBe(cacheKey("search", '"rwsdk" filename:package.json', 2));
  expect(cacheKey("search", "../../etc/passwd")).not.toContain("..");
});

test("cache: TTL, null kept apart from a miss, --fresh reads nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "trial-cache-"));
  let now = 1_000_000;
  const c = new Cache(dir, false, () => now);
  c.set("meta/x.json", { stars: 3 });
  c.set("pkg/y.json", null);
  now += DAY - 1;
  expect(c.get<{ stars: number }>("meta/x.json", DAY)).toEqual({ stars: 3 });
  expect(c.get("pkg/y.json")).toBeNull();
  expect(c.get("pkg/missing.json")).toBeUndefined();
  now += 2;
  expect(c.get<{ stars: number }>("meta/x.json", DAY)).toBeUndefined();
  expect(c.get<{ stars: number }>("meta/x.json")).toEqual({ stars: 3 }); // no TTL: keyed by pushed_at instead
  expect(new Cache(dir, true, () => now).get("pkg/y.json")).toBeUndefined();
});

const bucket = (remaining: number) => ({ limit: 5000, used: 5000 - remaining, remaining, reset: Date.UTC(2026, 9, 12, 13, 28) / 1000 });

test("budget: room for the calls plus a 500-call reserve, or a clear stop", () => {
  expect(overBudget(bucket(5000), 2000)).toBeUndefined();
  expect(overBudget(bucket(1500), 1000)).toBeUndefined(); // leaves exactly 500
  const msg = overBudget(bucket(1499), 1000)!;
  expect(msg).toContain("1499 of 5000 left");
  expect(msg).toContain("needs 1000 uncached calls");
  expect(msg).toContain("resets at 13:28 UTC");
  expect(overBudget(bucket(400), 0)).toBeDefined(); // already under the reserve
  expect(overBudget(bucket(1000), 100, 1000)).toBeDefined();
});

test("rate_limit parsing and the log line", () => {
  const json = JSON.stringify({ resources: { core: bucket(1200), search: { limit: 30, used: 0, remaining: 30, reset: 0 }, code_search: { limit: 10, used: 4, remaining: 6, reset: 0 } } });
  const r = parseRate(json)!;
  expect(r.search.limit).toBe(10);
  expect(rateLine(r)).toBe("github core 3800/5000, search 4/10, reset 13:28 UTC");
  expect(parseRate("gh: not logged in")).toBeUndefined();
  expect(parseRate("{}")).toBeUndefined();
});
