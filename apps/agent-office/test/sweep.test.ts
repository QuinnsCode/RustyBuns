import { expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cacheKey, lockVersions, pruneBunCache, slug, sweepScratch, WORKTREES } from "../live/sweep.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "rb-sweep-"));

test("a sent-home worker's scratch folder goes; live worktrees, their subfolders and anything unparsed stay", async () => {
  const root = tmp();
  const repo = path.join(root, "my.repo");
  mkdirSync(path.join(repo, WORKTREES, "nibble-1"), { recursive: true });
  const other = path.join(root, "unscanned"); // its worktrees folder doesn't exist: none of its folders go
  const base = path.join(root, "claude-501");
  const trees = (r: string) => slug(path.join(r, WORKTREES));
  const names = {
    live: `${trees(repo)}-nibble-1`,
    liveSub: `${trees(repo)}-nibble-1-apps-agent-office`,
    gone: `${trees(repo)}-nibble-2`,
    project: slug(repo),
    otherRepo: `${trees(other)}-bolt-1`,
    stray: "notes",
  };
  for (const n of Object.values(names)) mkdirSync(path.join(base, n), { recursive: true });
  writeFileSync(path.join(base, names.gone, "big"), Buffer.alloc(1 << 20));

  const dry = await sweepScratch([repo, other], false, base);
  expect(dry.paths).toEqual([path.join(base, names.gone)]);
  expect(dry.bytes).toBeGreaterThanOrEqual(1 << 20);
  expect(existsSync(path.join(base, names.gone))).toBe(true);

  const done = await sweepScratch([repo, other], true, base);
  expect(done.paths).toEqual([path.join(base, names.gone)]);
  for (const [k, n] of Object.entries(names)) expect([k, existsSync(path.join(base, n))]).toEqual([k, k !== "gone"]);
});

test("the bun cache keeps what any bun.lock names and recent downloads, and drops other versions with their links", async () => {
  const root = tmp();
  const cache = path.join(root, "cache");
  const checkout = path.join(root, "checkout");
  mkdirSync(path.join(checkout, "apps", "x"), { recursive: true });
  writeFileSync(path.join(checkout, "bun.lock"), `{
  "packages": {
    "a": ["a@1.0.0", "", { "optionalPeers": ["@s/b"] }, "sha512-x"],
    "@s/b": ["@s/b@1.0.0-rc.1", "", {}, "sha512-y"],
  }
}`);
  writeFileSync(path.join(checkout, "apps", "x", "bun.lock"), `{ "packages": { "c": ["c@3.0.0", "", {}, "sha512-z"] } }`);
  const dirs = ["a@1.0.0@@@1", "a@2.0.0@@@1", "@s/b@1.0.0-rc.1@@@1", "@s/b@0.9.0@@@1", "c@3.0.0@@@1", "c@2.0.0@@@1", "@GH@user-repo-abc@@@1", "fresh@1.0.0@@@1"];
  const old = new Date(Date.now() - 2 * 3_600_000);
  for (const d of dirs) {
    mkdirSync(path.join(cache, d), { recursive: true });
    if (d !== "fresh@1.0.0@@@1") utimesSync(path.join(cache, d), old, old);
  }
  writeFileSync(path.join(cache, "0019245d1f12eeb3.npm"), "{}");
  mkdirSync(path.join(cache, "a"));
  symlinkSync(path.join(cache, "a@1.0.0@@@1"), path.join(cache, "a", "1.0.0@@@1"));
  symlinkSync(path.join(cache, "a@2.0.0@@@1"), path.join(cache, "a", "2.0.0@@@1"));

  const dry = await pruneBunCache([checkout], false, cache);
  expect(dry.locks).toBe(2);
  expect(dry.paths.map((p) => path.relative(cache, p)).sort()).toEqual(["@s/b@0.9.0@@@1", "a@2.0.0@@@1", "c@2.0.0@@@1"]);
  expect(existsSync(path.join(cache, "a@2.0.0@@@1"))).toBe(true);

  await pruneBunCache([checkout], true, cache);
  const left = (p: string) => { try { lstatSync(path.join(cache, p)); return true; } catch { return false; } };
  expect(["a@1.0.0@@@1", "@s/b@1.0.0-rc.1@@@1", "c@3.0.0@@@1", "@GH@user-repo-abc@@@1", "fresh@1.0.0@@@1", "0019245d1f12eeb3.npm", "a/1.0.0@@@1"].filter((p) => !left(p))).toEqual([]);
  expect(["a@2.0.0@@@1", "@s/b@0.9.0@@@1", "c@2.0.0@@@1", "a/2.0.0@@@1"].filter(left)).toEqual([]);
});

test("with no lockfile to go by, the cache is left alone", async () => {
  const root = tmp();
  mkdirSync(path.join(root, "cache", "a@1.0.0@@@1"), { recursive: true });
  const r = await pruneBunCache([path.join(root, "empty")], true, path.join(root, "cache"), 0);
  expect(r.refused).toContain("no bun.lock");
  expect(existsSync(path.join(root, "cache", "a@1.0.0@@@1"))).toBe(true);
});

test("lockfile and cache names parse the same way, and odd ones parse to nothing", () => {
  const keep = lockVersions(`"x": ["@alchemy.run/acme@2.0.0-beta.84", ""], "w": ["w@workspace:packages/w"], "p": { "optionalPeers": ["@alchemy.run/domain"] }`);
  expect([...keep]).toEqual(["@alchemy.run/acme@2.0.0-beta.84", "w@workspace:packages/w"]);
  expect(cacheKey("@alchemy.run/acme@2.0.0-beta.84@@@1")).toBe("@alchemy.run/acme@2.0.0-beta.84");
  expect([cacheKey("@T@24e5fbdaf51fd700@@@1"), cacheKey("accepts"), cacheKey("x.npm"), cacheKey("a@1.0.0@@hash@@@1")]).toEqual([undefined, undefined, undefined, undefined]);
});
