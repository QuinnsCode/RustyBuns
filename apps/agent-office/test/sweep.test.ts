import { expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cacheKey, inUse, lockVersions, playwrightBuilds, pruneBunCache, prunePlaywright, slug, sweepBuilt, sweepHalfGone, sweepHalfRemoved, sweepScratch, WORKTREES } from "../live/sweep.ts";

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

test("node_modules and ignored build output go from worktrees nobody sits at; a seated one, a fresh hire's, a checked-in dist and the code stay", async () => {
  const repo = tmp();
  const git = (dir: string, ...a: string[]) => Bun.spawnSync(["git", "-C", dir, ...a], { stdout: "ignore", stderr: "ignore" });
  const tree = (name: string, hoursOld: number) => {
    const dir = path.join(repo, WORKTREES, name);
    for (const m of ["node_modules/effect", "apps/game/node_modules/three", "apps/game/dist", "apps/tool/target/debug", "apps/game/.wrangler/tmp", "apps/docs/dist"]) mkdirSync(path.join(dir, m), { recursive: true });
    writeFileSync(path.join(dir, "node_modules/effect/index.js"), Buffer.alloc(1 << 20));
    writeFileSync(path.join(dir, "apps/game/main.ts"), "work");
    writeFileSync(path.join(dir, "bun.lock"), "{}");
    writeFileSync(path.join(dir, "apps/docs/dist/index.html"), "checked in");
    writeFileSync(path.join(dir, ".gitignore"), "node_modules\ndist\ntarget\n.wrangler\n");
    git(dir, "init", "-q");
    git(dir, "add", "-f", ".gitignore", "apps/game/main.ts", "apps/docs/dist/index.html");
    const at = (Date.now() - hoursOld * 3_600_000) / 1000;
    utimesSync(path.join(dir, ".git"), at, at);
    return dir;
  };
  const seated = tree("gizmo-1", 30), left = tree("nibble-2", 30), hiring = tree("bolt-3", 0.1);
  const gone = ["node_modules", "apps/game/node_modules", "apps/game/dist", "apps/tool/target", "apps/game/.wrangler/tmp"].map((p) => path.join(left, p));

  const dry = await sweepBuilt(repo, [seated], false);
  expect(dry.paths.sort()).toEqual([...gone].sort());
  expect(dry.bytes).toBeGreaterThanOrEqual(1 << 20);
  expect(existsSync(path.join(left, "node_modules"))).toBe(true);

  await sweepBuilt(repo, [seated], true);
  expect(gone.filter((p) => existsSync(p))).toEqual([]);
  expect([existsSync(path.join(left, "apps/game/main.ts")), existsSync(path.join(left, "apps/docs/dist/index.html"))]).toEqual([true, true]);
  expect([existsSync(path.join(seated, "apps/game/dist")), existsSync(path.join(hiring, "node_modules"))]).toEqual([true, true]);
  // the empty desk's root node_modules went to the pool for the next hire (#5656), not the bin
  expect(readdirSync(path.join(repo, ".agent-office/node-pool")).map((n) => readdirSync(path.join(repo, ".agent-office/node-pool", n)))).toEqual([["node_modules"]]);
});

// 2026-11-22: six workers whose PR had merged sat at their desks with "go home once merged" off, 6 GB of node_modules each
test("a seated worker whose PR merged loses its node_modules and build output like an empty desk; one still working keeps them", async () => {
  const repo = tmp();
  const tree = (name: string) => {
    const dir = path.join(repo, WORKTREES, name);
    mkdirSync(path.join(dir, "node_modules/effect"), { recursive: true });
    writeFileSync(path.join(dir, "main.ts"), "work");
    Bun.spawnSync(["git", "-C", dir, "init", "-q"], { stdout: "ignore", stderr: "ignore" });
    const at = (Date.now() - 30 * 3_600_000) / 1000;
    utimesSync(path.join(dir, ".git"), at, at);
    return dir;
  };
  const landed = tree("gizmo-1"), working = tree("nibble-2");
  const desks = [{ id: "g", worktree: { path: path.join(WORKTREES, "gizmo-1") } }, { id: "n", worktree: { path: path.join(WORKTREES, "nibble-2") } }, { id: "shell" }];
  const live = inUse(repo, desks, new Set(["g"]));
  expect(live).toEqual([working]);
  await sweepBuilt(repo, live, true);
  expect([existsSync(path.join(landed, "node_modules")), existsSync(path.join(landed, "main.ts")), existsSync(path.join(working, "node_modules"))]).toEqual([false, true, true]);
});

test("Playwright keeps the builds any installed playwright-core names and drops the rest", async () => {
  const root = tmp();
  const dir = path.join(root, "ms-playwright"), cache = path.join(root, "cache"), checkout = path.join(root, "checkout");
  const core = (at: string, builds: Record<string, string>) => {
    mkdirSync(at, { recursive: true });
    writeFileSync(path.join(at, "browsers.json"), JSON.stringify({ browsers: Object.entries(builds).map(([name, revision]) => ({ name, revision })) }));
  };
  core(path.join(cache, "playwright-core@1.62.1@@@1"), { chromium: "1234", "chromium-headless-shell": "1234" });
  core(path.join(checkout, "node_modules", ".pnpm", "playwright-core@1.57.0", "node_modules", "playwright-core"), { firefox: "1497" });
  const elsewhere = path.join(root, "elsewhere", "playwright-core"); // known only through Playwright's own .links
  core(elsewhere, { webkit: "2227" });
  mkdirSync(path.join(dir, ".links"), { recursive: true });
  writeFileSync(path.join(dir, ".links", "abc"), elsewhere);
  writeFileSync(path.join(dir, ".links", "old"), path.join(root, "deleted-project"));
  const kept = ["chromium-1234", "chromium_headless_shell-1234", "firefox-1497", "webkit-2227", "notes"];
  const old = ["chromium-1200", "chromium_headless_shell-1200", "ffmpeg-1011"];
  for (const n of [...kept, ...old, "chromium-1300"]) mkdirSync(path.join(dir, n), { recursive: true });
  const at = (Date.now() - 2 * 3_600_000) / 1000;
  for (const n of [...kept, ...old]) utimesSync(path.join(dir, n), at, at); // chromium-1300 is an install running now

  const dry = await prunePlaywright([checkout], false, dir, cache);
  expect([dry.paths.map((p) => path.basename(p)).sort(), dry.locks]).toEqual([[...old].sort(), 3]);
  await prunePlaywright([checkout], true, dir, cache);
  expect(old.filter((n) => existsSync(path.join(dir, n)))).toEqual([]);
  expect([...kept, "chromium-1300"].filter((n) => !existsSync(path.join(dir, n)))).toEqual([]);

  // no playwright-core found: nothing is known to be unused, so nothing goes
  expect((await prunePlaywright([], true, path.join(root, "empty"), path.join(root, "none"))).refused).toContain("nothing is known");
  expect(playwrightBuilds({ browsers: [{ name: "webkit", revision: "2227", revisionOverrides: { mac12: "2009" } }] })).toEqual(["webkit-2227", "webkit-2009"]);
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

// #5657: 50 folders a cut-off send-home left behind (no .git, forgotten by git), 400 MB each, that no rule removed
test("a half-deleted worktree folder an hour old goes after what runs in it ends; a live worktree and a fresh checkout stay", async () => {
  const repo = tmp();
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repo, ...a], { stdout: "ignore", stderr: "ignore" });
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(repo, "a.txt"), "a\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
  const trees = path.join(repo, WORKTREES);
  const live = path.join(trees, "live-1"), half = path.join(trees, "bolt-2fe0"), fresh = path.join(trees, "hiring-1");
  git("worktree", "add", "-q", "-b", "office/live-1", live);
  for (const d of [half, fresh]) mkdirSync(path.join(d, "apps/game"), { recursive: true });
  writeFileSync(path.join(half, "apps/game/main.ts"), Buffer.alloc(1 << 20));
  const old = (Date.now() - 2 * 3_600_000) / 1000;
  for (const d of [live, half]) utimesSync(d, old, old);

  const ended: string[] = [];
  const done = await sweepHalfGone(repo, true, async (d) => { ended.push(d); });
  expect(done.paths).toEqual([half]);
  expect(ended).toEqual([half]);
  expect(done.bytes).toBeGreaterThanOrEqual(1 << 20);
  expect([existsSync(half), existsSync(path.join(live, "a.txt")), existsSync(fresh)]).toEqual([false, true, true]);
});

test("a worker's folder of worktrees across repositories is not a half-deleted one, however old", async () => {
  const repo = tmp();
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdout: "ignore", stderr: "ignore" });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "a");
  // its own repo's worktree one level down, and a second folder holding only another repository's
  const trees = path.join(repo, WORKTREES), ours = path.join(trees, "ws", "repo"), theirs = path.join(trees, "ws2", "other");
  git("worktree", "add", "-q", "-b", "office/ws", ours);
  mkdirSync(theirs, { recursive: true });
  writeFileSync(path.join(theirs, ".git"), "gitdir: elsewhere\n");
  for (const d of [ours, theirs]) writeFileSync(path.join(d, "uncommitted.txt"), "work\n");
  const old = (Date.now() - 2 * 3_600_000) / 1000;
  for (const d of ["ws", "ws2"]) utimesSync(path.join(trees, d), old, old);

  expect((await sweepHalfGone(repo, true, async () => {})).paths).toEqual([]);
  expect([ours, theirs].map((d) => existsSync(path.join(d, "uncommitted.txt")))).toEqual([true, true]);
});

// #5913: a remove cut off part way that kept its .git (git still lists it, every deleted file an "uncommitted change")
test("a listed worktree with only deleted files goes through git; one with work, one unpushed, a seated one and a fresh one stay", async () => {
  const root = tmp();
  const remote = path.join(root, "remote.git"), repo = path.join(root, "repo");
  const git = (dir: string, ...a: string[]) => Bun.spawnSync(["git", "-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdout: "ignore", stderr: "ignore" });
  Bun.spawnSync(["git", "init", "-q", "--bare", remote]);
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  for (const f of ["a.txt", "b.txt"]) writeFileSync(path.join(repo, f), `${f}\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "a");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "origin", "main");
  const trees = path.join(repo, WORKTREES);
  const at = (n: string) => path.join(trees, n);
  const names = ["cut-1", "work-1", "ahead-1", "seated-1", "fresh-1"];
  for (const n of names) { git(repo, "worktree", "add", "-q", "-b", `office/${n}`, at(n), "main"); rmSync(path.join(at(n), "a.txt")); }
  writeFileSync(path.join(at("work-1"), "new.ts"), "work");
  writeFileSync(path.join(at("ahead-1"), "b.txt"), "changed");
  git(at("ahead-1"), "commit", "-qam", "unpushed");
  rmSync(path.join(at("ahead-1"), "b.txt"));
  const old = (Date.now() - 2 * 3_600_000) / 1000;
  for (const n of names.filter((n) => n !== "fresh-1")) utimesSync(at(n), old, old);

  const ended: string[] = [];
  const done = await sweepHalfRemoved(repo, [at("seated-1")], true, async (d) => { ended.push(d); });
  expect(done.paths).toEqual([at("cut-1")]);
  expect(ended).toEqual([at("cut-1")]);
  expect(names.map((n) => [n, existsSync(at(n))])).toEqual(names.map((n) => [n, n !== "cut-1"]));
  const listed = Bun.spawnSync(["git", "-C", repo, "worktree", "list"]).stdout.toString();
  expect(listed).not.toContain("cut-1");
});
