// What sent-home workers leave on disk, swept by rules that can only hit what nobody uses (#3325).
//
// On 2026-11-03 the office Mac's disk filled to 36 MB free. Two things grow and nothing trimmed them:
//  1. Claude Code's scratch, /private/tmp/claude-<uid>/<slug of the session's directory>. Sending a worker home deletes its
//     worktree but not this folder. A folder goes only when its slug is `<repo>/.agent-office/worktrees/<name>` for a repo
//     we know, that repo's worktrees folder exists, and no worktree in it is <name> (or a parent of it, for a session
//     started in a subfolder). Anything that doesn't parse stays. The office runs it on start and after each send-home.
//  2. Bun's cache, ~/.bun/install/cache, which keeps every version ever downloaded. `pruneBunCache` keeps what any
//     bun.lock in a live checkout or worktree names and removes other `name@version@@@N` folders. Manual, dry run first.
//  3. node_modules and build output (`dist`, `target`, `.wrangler/tmp`, only where git ignores them) in worktrees no
//     worker sits at (kept on send-home because git sees work main lacks). A seated worker may be serving its `dist`, so
//     the rule needs the office's list of who sits where: the office runs it after each send-home, with the workers it
//     has; `office:sweep` asks `office-workers list` and skips without it (#3387). A merged worker at rest counts as
//     gone, and each floor sweeps every 30 minutes too (see `sweepEvery`, below).
//  4. Playwright's browser builds no installed playwright-core names (`prunePlaywright`, manual, dry run first).
//  5. Worktree folders a send-home left half deleted: no `.git`, not in `git worktree list`, an hour old (`sweepHalfGone`,
//     #5657). What still runs in one ends first. Every floor sweep runs it. And listed worktrees nobody sits at whose
//     only changes are files deleted by a cut-off remove (`sweepHalfRemoved`, #5913), when the sweep knows who sits where.
// Plus, for `bun run office:sweep`: the other package caches, through each tool's own command, and a list of worktrees
// still on disk with what sending each home would lose (sending home is the owner's call, so this never deletes one).
import { existsSync, realpathSync, statfsSync } from "node:fs";
import { lstat, readdir, readFile, readlink, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { arr, check, obj, opt, rec, str } from "@rustybuns/util/guard";
import { poolModules } from "./install.ts";
import { endIn } from "./reaper.ts";

export const WORKTREES = path.join(".agent-office", "worktrees");
const GB = 1024 ** 3;
export const gb = (b: number) => `${(b / GB).toFixed(1)} GB`;

/** Claude Code's name for a directory's scratch folder: the path with / and . as -. */
export const slug = (p: string) => p.replace(/[/.]/g, "-");

export function scratchBase(uid = process.getuid?.() ?? 0, tmp = process.platform === "darwin" ? "/private/tmp" : "/tmp") {
  return path.join(tmp, `claude-${uid}`);
}

export interface Repo {
  dir: string;
  /** The names in its worktrees folder, or undefined when that folder can't be read (then nothing of it is swept). */
  trees: string[] | undefined;
}

/**
 * The scratch folders (by name) that belong to a worktree that is gone. A name is swept only when it is under some repo's
 * worktrees and every repo it could be under (two paths can share a slug) has its worktrees folder and no worktree for it.
 */
export function deadScratch(names: string[], repos: Repo[]): string[] {
  return names.filter((name) => {
    let matched = false;
    for (const r of repos) {
      const prefix = `${slug(path.join(r.dir, WORKTREES))}-`;
      if (!name.startsWith(prefix)) continue;
      const rest = name.slice(prefix.length);
      if (!rest || !r.trees) return false;
      if (r.trees.some((t) => rest === slug(t) || rest.startsWith(`${slug(t)}-`))) return false;
      matched = true;
    }
    return matched;
  });
}

async function treesOf(dir: string): Promise<string[] | undefined> {
  try { return await readdir(path.join(dir, WORKTREES)); } catch { return undefined; }
}

/** Kilobytes on disk of each path (`du -sk`, in batches; paths after `--` since scratch slugs start with -). */
export async function duKb(paths: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < paths.length; i += 400) {
    const batch = paths.slice(i, i + 400);
    const proc = Bun.spawn(["du", "-sk", "--", ...batch], { stdout: "pipe", stderr: "ignore" });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    for (const line of text.split("\n")) {
      const m = /^(\d+)\t(.+)$/.exec(line);
      if (m) out.set(m[2]!, Number(m[1]));
    }
  }
  return out;
}

export interface Swept {
  /** What it removed (or would, on a dry run). */
  paths: string[];
  bytes: number;
}

/** Removes (`go`) or lists the scratch folders of `repos`' worktrees that are gone. Never throws. */
export async function sweepScratch(repoDirs: string[], go: boolean, base = scratchBase()): Promise<Swept> {
  let names: string[];
  try { names = await readdir(base); } catch { return { paths: [], bytes: 0 }; }
  const repos = await Promise.all(repoDirs.map(async (dir) => ({ dir, trees: await treesOf(dir) })));
  const paths: string[] = [];
  for (const name of deadScratch(names, repos)) {
    const p = path.join(base, name);
    try { if ((await lstat(p)).isDirectory()) paths.push(p); } catch {}
  }
  const sizes = await duKb(paths);
  let bytes = 0;
  for (const p of paths) {
    if (go) {
      // look again just before: a worker hired since the listing may have made this worktree
      const name = path.basename(p);
      const again = await Promise.all(repoDirs.map(async (dir) => ({ dir, trees: await treesOf(dir) })));
      if (!deadScratch([name], again).length) continue;
      try { await rm(p, { recursive: true, force: true }); } catch { continue; }
    }
    bytes += (sizes.get(p) ?? 0) * 1024;
  }
  return { paths, bytes };
}

/** Build output a build or dev server puts back; it goes only where git ignores it (an app may check a `dist` in). */
const BUILT = new Set(["dist", "target"]);

/**
 * What `bun install` and a build put back in a worktree: each `node_modules` (root's and each workspace's), and each
 * git-ignored `dist`, `target` and `.wrangler/tmp`, a few levels down, never inside another.
 */
async function rebuildableIn(tree: string, depth = 3): Promise<string[]> {
  const modules: string[] = [];
  const built: string[] = [];
  async function walk(dir: string, left: number) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === ".git") continue;
      const p = path.join(dir, e.name);
      if (e.name === "node_modules") modules.push(p);
      else if (BUILT.has(e.name)) built.push(p);
      else if (e.name === ".wrangler") { if (existsSync(path.join(p, "tmp"))) built.push(path.join(p, "tmp")); }
      else if (left > 0) await walk(p, left - 1);
    }
  }
  await walk(tree, depth);
  if (!built.length) return modules;
  // a folder git doesn't call ignored (or can't say), or that holds a tracked file (check-ignore skips the index), stays
  const rel = built.map((p) => path.relative(tree, p));
  const lines = async (cmd: string[]) => (await run(["git", "-C", tree, ...cmd, "--", ...rel])).split("\n").filter(Boolean);
  const ignored = new Set((await lines(["check-ignore"])).map((r) => path.resolve(tree, r)));
  const tracked = (await lines(["ls-files"])).map((r) => path.resolve(tree, r));
  return [...modules, ...built.filter((p) => ignored.has(p) && !tracked.some((t) => t.startsWith(p + path.sep)))];
}

/**
 * Removes (`go`) or lists the `node_modules` and git-ignored build output of `repo`'s worktrees that no worker sits at
 * (`live`: their paths). A worker sent home with work git can't see on main (a squash-merged branch looks unlanded) keeps
 * its worktree, and the hire step's `bun install` (#3167) left 3-5 GB in each. The code stays; only what `bun install`
 * or a build puts back goes. Never throws.
 */
export async function sweepBuilt(repo: string, live: string[], go: boolean, now = Date.now()): Promise<Swept> {
  const seated = new Set(live.map((p) => path.resolve(p)));
  const trees = ((await treesOf(repo)) ?? []).map((n) => path.join(repo, WORKTREES, n)).filter((t) => !seated.has(t));
  // a worktree made in the last hour may be a hire still installing, before its worker is on the list
  const old = await Promise.all(trees.map(async (t) => { try { return now - (await lstat(path.join(t, ".git"))).mtimeMs > 3_600_000; } catch { return false; } }));
  const paths = (await Promise.all(trees.filter((_, i) => old[i]).map((t) => rebuildableIn(t)))).flat();
  const sizes = await duKb(paths);
  let bytes = 0;
  for (const p of paths) {
    // a worktree's root node_modules goes to the pool for the next hire (#5656): no files deleted, nothing freed
    if (go && trees.includes(path.dirname(p)) && path.basename(p) === "node_modules" && await poolModules(path.dirname(p))) continue;
    if (go) try { await rm(p, { recursive: true, force: true }); } catch { continue; }
    bytes += (sizes.get(p) ?? 0) * 1024;
  }
  return { paths, bytes };
}

// 2026-11-23 (#5657): 50 of 172 folders in the office's worktrees were half-deleted, about 400 MB each: no `.git`, and
// not in `git worktree list`. A send-home cut off part way (git's 60 s `worktree remove` timeout, the office exiting
// 300 ms after a shutdown, an `rm` racing a process still writing there) left the folder, then `git worktree prune`
// forgot it, and no rule here touched a folder git doesn't know. Such a folder an hour old now goes, after whatever
// still runs in it ends. Its scratch folder goes on the next sweep, once the folder is gone.

/**
 * The folders in `repo`'s worktrees that are left over from a send-home cut off part way: an hour old or more, no
 * `.git` in them, and not in `git worktree list`. None when git can't list its worktrees.
 */
export async function halfGone(repo: string, now = Date.now()): Promise<string[]> {
  const listed = (await run(["git", "-C", repo, "worktree", "list", "--porcelain"])).split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
  if (!listed.length) return [];
  const known = new Set(listed.flatMap((p) => { try { return [path.resolve(p), realpathSync(p)]; } catch { return [path.resolve(p)]; } }));
  const out: string[] = [];
  for (const name of (await treesOf(repo)) ?? []) {
    const dir = path.join(repo, WORKTREES, name);
    try {
      const st = await lstat(dir);
      if (!st.isDirectory() || now - st.mtimeMs < 3_600_000) continue; // a hire's checkout makes its folder before git lists it
      if (known.has(dir) || known.has(realpathSync(dir))) continue;
      try { await lstat(path.join(dir, ".git")); continue; } catch {}
      // a worker hired across repositories sits in a folder of worktrees (<slug>/<repo>): not left over, though git lists
      // no worktree at the folder itself. A child with a `.git` is another repository's, which this one's list can't name.
      const inside = [dir + path.sep, realpathSync(dir) + path.sep];
      if ([...known].some((k) => inside.some((d) => k.startsWith(d)))) continue;
      if ((await readdir(dir)).some((child) => existsSync(path.join(dir, child, ".git")))) continue;
      out.push(dir);
    } catch {}
  }
  return out;
}

/** Removes (`go`) or lists `halfGone(repo)`, ending what still runs in each first (`end`, the reaper's `endIn`). Never throws. */
export async function sweepHalfGone(repo: string, go: boolean, end: (dir: string) => Promise<unknown> = endIn, now = Date.now()): Promise<Swept> {
  const paths = await halfGone(repo, now);
  const sizes = await duKb(paths);
  let bytes = 0;
  for (const p of paths) {
    if (go) try { await end(p); await rm(p, { recursive: true, force: true }); } catch { continue; }
    bytes += (sizes.get(p) ?? 0) * 1024;
  }
  return { paths, bytes };
}

// 2026-11-24 (#5913): 31 worktrees (26 GB) were removes cut off part way that kept their `.git`: hundreds of tracked files
// deleted, nothing else changed, so git still lists them, every deletion counts as an uncommitted change and send-home
// keeps them, and `halfGone` skips anything with a `.git`. One nobody sits at, an hour old, with nothing unpushed and
// only unstaged deletions (` D`) in its status, is finished with `git worktree remove --force --force`.

/**
 * The worktrees of `repo` that git still lists but a cut-off remove left part deleted: not in `live`, an hour old or
 * more, no commit that no remote has, and a `git status` of only unstaged deletions. None when git can't answer.
 */
export async function halfRemoved(repo: string, live: string[], now = Date.now()): Promise<string[]> {
  const seated = new Set(live.flatMap((p) => { try { return [path.resolve(p), realpathSync(p)]; } catch { return [path.resolve(p)]; } }));
  const out: string[] = [];
  for (const name of (await treesOf(repo)) ?? []) {
    const dir = path.join(repo, WORKTREES, name);
    try {
      const st = await lstat(dir);
      if (!st.isDirectory() || now - st.mtimeMs < 3_600_000) continue;
      if (seated.has(dir) || seated.has(realpathSync(dir))) continue;
      await lstat(path.join(dir, ".git"));
    } catch { continue; }
    // not `run`: its trim would eat the first line's leading space
    const proc = Bun.spawn(["git", "-C", dir, "status", "--porcelain", "-uall"], { stdout: "pipe", stderr: "ignore" });
    const status = (await new Response(proc.stdout).text()).split("\n").filter(Boolean);
    if ((await proc.exited) !== 0 || !status.length || !status.every((l) => l.startsWith(" D "))) continue;
    if (await run(["git", "-C", dir, "rev-list", "--count", "HEAD", "--not", "--remotes"]) !== "0") continue;
    out.push(dir);
  }
  return out;
}

/** Removes (`go`) or lists `halfRemoved(repo, live)` through git, ending what still runs in each first. Never throws. */
export async function sweepHalfRemoved(repo: string, live: string[], go: boolean, end: (dir: string) => Promise<unknown> = endIn, now = Date.now()): Promise<Swept> {
  const paths = await halfRemoved(repo, live, now);
  const sizes = await duKb(paths);
  const done: string[] = [];
  let bytes = 0;
  for (const p of paths) {
    if (go) {
      try { await end(p); } catch { continue; }
      const proc = Bun.spawn(["git", "-C", repo, "worktree", "remove", "--force", "--force", p], { stdout: "ignore", stderr: "ignore" });
      if ((await proc.exited) !== 0) continue;
    }
    done.push(p);
    bytes += (sizes.get(p) ?? 0) * 1024;
  }
  return { paths: done, bytes };
}

/**
 * The office's hook: sweep one floor's repo, and say what it freed in one line ('' when nothing). With `live` (the
 * worktree paths workers sit at), also the half-removed worktrees git still lists and the `node_modules` and build
 * output of every other worktree.
 */
export async function sweepFloor(dir: string, live?: string[]): Promise<string> {
  try {
    const h = await sweepHalfGone(dir, true);
    const hr = live ? await sweepHalfRemoved(dir, live, true) : { paths: [], bytes: 0 };
    // Claude names the folder from the path as the worker was started, which may or may not have its symlinks resolved
    const r = await sweepScratch([...new Set([dir, realpathSync(dir)])], true);
    const m = live ? await sweepBuilt(dir, live, true) : { paths: [], bytes: 0 };
    const said = [
      h.paths.length && `${h.paths.length} half-deleted worktree folder${h.paths.length === 1 ? "" : "s"}`,
      hr.paths.length && `${hr.paths.length} half-removed worktree${hr.paths.length === 1 ? "" : "s"}`,
      r.paths.length && `${r.paths.length} scratch folder${r.paths.length === 1 ? "" : "s"} of gone worktrees`,
      m.paths.length && `${m.paths.length} node_modules and build folder${m.paths.length === 1 ? "" : "s"} in worktrees nobody works in`,
    ].filter(Boolean);
    return said.length ? `🧹 Swept ${said.join(", ")}, ${gb(h.bytes + hr.bytes + r.bytes + m.bytes)} freed` : "";
  } catch { return ""; }
}

// --- Bun's cache -----------------------------------------------------------------------------------------------------

/** Every `name@version` a bun.lock's packages resolve to (the first string of each entry). */
export function lockVersions(text: string, into = new Set<string>()): Set<string> {
  for (const m of text.matchAll(/:\s*\[\s*"((?:@[^"/@]+\/)?[^"@]+)@([^"]+)"/g)) into.add(`${m[1]}@${m[2]}`);
  return into;
}

/** A cache folder (relative, e.g. `@types/node@20.1.0@@@1`) as `name@version`, or undefined for anything else (kept). */
export function cacheKey(rel: string): string | undefined {
  const m = /^((?:@[^/@]+\/)?[^/@]+)@(\d[^@/]*)@@@\d+$/.exec(rel);
  return m ? `${m[1]}@${m[2]}` : undefined;
}

/** The cache folders no lockfile names. */
export function cacheToPrune(entries: string[], keep: Set<string>): string[] {
  return entries.filter((e) => {
    const k = cacheKey(e);
    return k !== undefined && !keep.has(k);
  });
}

/** Lockfiles under `root`, a few levels down, not inside node_modules, .git or a repo's own worktrees. */
async function lockfiles(root: string, depth = 4): Promise<{ locks: string[]; binary: string[] }> {
  const locks: string[] = [];
  const binary: string[] = [];
  const walk = async (dir: string, d: number) => {
    let entries: import("node:fs").Dirent[];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    const names = new Set(entries.map((e) => e.name));
    if (names.has("bun.lock")) locks.push(path.join(dir, "bun.lock"));
    else if (names.has("bun.lockb")) binary.push(path.join(dir, "bun.lockb"));
    if (d >= depth) return;
    for (const e of entries)
      if (e.isDirectory() && !["node_modules", ".git", ".agent-office", "dist", "target"].includes(e.name)) await walk(path.join(dir, e.name), d + 1);
  };
  await walk(root, 0);
  return { locks, binary };
}

/** Every checkout of a repo git knows (its own and each worktree, wherever they are). */
async function checkoutsOf(repo: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "-C", repo, "worktree", "list", "--porcelain"], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  const dirs = text.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
  return dirs.length ? dirs : [repo];
}

export interface Pruned extends Swept {
  locks: number;
  /** Why nothing was pruned, when that's the answer. */
  refused?: string;
}

/**
 * Removes (`go`) or lists the Bun cache folders that no bun.lock in `roots` (and every checkout git knows of them) names.
 * Folders touched in the last `freshMs` stay, so an install running right now keeps what it just fetched.
 */
export async function pruneBunCache(roots: string[], go: boolean, cache = path.join(homedir(), ".bun", "install", "cache"), freshMs = 3_600_000): Promise<Pruned> {
  const keep = new Set<string>();
  const dirs = new Set<string>();
  for (const r of roots) for (const d of existsSync(path.join(r, ".git")) ? await checkoutsOf(r) : [r]) dirs.add(d);
  let locks = 0;
  for (const d of dirs) {
    const found = await lockfiles(d);
    if (found.binary.length) return { paths: [], bytes: 0, locks, refused: `can't read the binary lockfile ${found.binary[0]}; run \`bun install --save-text-lockfile\` there first` };
    for (const f of found.locks) { lockVersions(await readFile(f, "utf8"), keep); locks++; }
  }
  if (!keep.size) return { paths: [], bytes: 0, locks, refused: "no bun.lock found, so nothing is known to be unused" };
  let top: string[];
  try { top = await readdir(cache); } catch { return { paths: [], bytes: 0, locks }; }
  const entries: string[] = [];
  for (const e of top) {
    if (e.startsWith("@") && !e.includes("@", 1)) {
      try { for (const s of await readdir(path.join(cache, e))) entries.push(`${e}/${s}`); } catch {}
    } else entries.push(e);
  }
  const now = Date.now();
  const paths: string[] = [];
  for (const rel of cacheToPrune(entries, keep)) {
    const p = path.join(cache, rel);
    try {
      const s = await lstat(p);
      if (s.isDirectory() && now - s.mtimeMs > freshMs) paths.push(p);
    } catch {}
  }
  const sizes = await duKb(paths);
  let bytes = 0;
  const gone = new Set<string>();
  for (const p of paths) {
    if (go) { try { await rm(p, { recursive: true, force: true }); gone.add(p); } catch { continue; } }
    bytes += (sizes.get(p) ?? 0) * 1024;
  }
  // Bun's `<name>/<version>@@@N` links point at those folders: drop the ones left dangling
  if (go) for (const e of top) {
    if (e.includes("@", 1)) continue;
    const parents = e.startsWith("@") ? (await readdir(path.join(cache, e)).catch(() => [])).filter((s) => !s.includes("@")).map((s) => path.join(cache, e, s)) : [path.join(cache, e)];
    for (const parent of parents) {
      for (const l of await readdir(parent).catch(() => [])) {
        const link = path.join(parent, l);
        const to = await readlink(link).catch(() => undefined);
        if (to && gone.has(path.resolve(parent, to))) await rm(link, { force: true }).catch(() => {});
      }
    }
  }
  return { paths, bytes, locks };
}

// --- other package caches ----------------------------------------------------------------------------------------------

export interface Cache {
  name: string;
  dir: string;
  /** The tool's own clean-up; undefined means report only (nothing provably safe to run). */
  clean?: string[];
}

export function caches(home = homedir()): Cache[] {
  const lib = path.join(home, "Library", "Caches");
  return [
    { name: "npm", dir: path.join(home, ".npm"), clean: ["npm", "cache", "clean", "--force"] },
    { name: "Homebrew", dir: path.join(lib, "Homebrew"), clean: ["brew", "cleanup"] },
    { name: "pnpm", dir: path.join(lib, "pnpm"), clean: ["pnpm", "store", "prune"] },
    { name: "Google", dir: path.join(lib, "Google") },
    { name: "VS Code updater", dir: path.join(lib, "com.microsoft.VSCode.ShipIt") },
  ];
}

// --- Playwright's browser builds ---------------------------------------------------------------------------------------

/** What a playwright-core's `browsers.json` says it downloads; only the names and revisions matter here. */
const BrowsersJson = obj({ browsers: arr(obj({ name: str(100), revision: str(40), revisionOverrides: opt(rec(str(40), 100)) }), 100) });

/** The build folders (`chromium_headless_shell-1200`) a `browsers.json` names, every platform's override included. */
export function playwrightBuilds(json: unknown): string[] {
  const got = check(BrowsersJson, json);
  return (got?.browsers ?? []).flatMap((b) => [b.revision, ...Object.values(b.revisionOverrides ?? {})].map((r) => `${b.name.replace(/-/g, "_")}-${r}`));
}

/**
 * The playwright-core packages on this Mac we can find: the ones `playwright install` wrote into `.links` (Playwright's
 * own record of who uses the folder), each version in Bun's cache, and each checkout's `node_modules/playwright-core`.
 */
async function playwrightCores(dir: string, roots: string[], cache: string): Promise<string[]> {
  const out = new Set<string>();
  for (const l of await readdir(path.join(dir, ".links")).catch(() => [])) {
    const to = (await readFile(path.join(dir, ".links", l), "utf8").catch(() => "")).trim();
    if (to) out.add(to);
  }
  for (const e of await readdir(cache).catch(() => [])) if (e.startsWith("playwright-core@")) out.add(path.join(cache, e));
  for (const r of roots) for (const d of existsSync(path.join(r, ".git")) ? await checkoutsOf(r) : [r]) {
    out.add(path.join(d, "node_modules", "playwright-core"));
    // pnpm keeps each version in its own store folder, linked only where it's a direct dependency
    const pnpm = path.join(d, "node_modules", ".pnpm");
    for (const e of await readdir(pnpm).catch(() => [])) if (e.startsWith("playwright-core@")) out.add(path.join(pnpm, e, "node_modules", "playwright-core"));
  }
  return [...out];
}

/**
 * Removes (`go`) or lists the browser builds in Playwright's folder that no playwright-core we can find names. Playwright
 * has no such command (`playwright uninstall` drops this install's own builds). Folders that aren't `<name>-<revision>`,
 * and any touched in the last `freshMs` (an install running now), stay; a missed user only costs a `playwright install`.
 */
export async function prunePlaywright(roots: string[], go: boolean, dir = path.join(homedir(), "Library", "Caches", "ms-playwright"), cache = path.join(homedir(), ".bun", "install", "cache"), freshMs = 3_600_000): Promise<Pruned> {
  const keep = new Set<string>();
  let locks = 0;
  for (const core of await playwrightCores(dir, roots, cache)) {
    const text = await readFile(path.join(core, "browsers.json"), "utf8").catch(() => undefined);
    if (text === undefined) continue;
    let json: unknown;
    try { json = JSON.parse(text); } catch { continue; }
    const builds = playwrightBuilds(json);
    if (!builds.length) continue;
    for (const b of builds) keep.add(b);
    locks++;
  }
  if (!keep.size) return { paths: [], bytes: 0, locks, refused: "no playwright-core's browsers.json found, so nothing is known to be unused" };
  const now = Date.now();
  const paths: string[] = [];
  for (const e of await readdir(dir).catch(() => [])) {
    if (!/^[a-z][a-z_]*-\d+$/.test(e) || keep.has(e)) continue;
    const p = path.join(dir, e);
    try {
      const s = await lstat(p);
      if (s.isDirectory() && now - s.mtimeMs > freshMs) paths.push(p);
    } catch {}
  }
  const sizes = await duKb(paths);
  let bytes = 0;
  for (const p of paths) {
    if (go) try { await rm(p, { recursive: true, force: true }); } catch { continue; }
    bytes += (sizes.get(p) ?? 0) * 1024;
  }
  return { paths, bytes, locks };
}

// --- worktrees still on disk ------------------------------------------------------------------------------------------

async function run(cmd: string[], cwd?: string): Promise<string> {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "ignore" });
    const text = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? text.trim() : "";
  } catch { return ""; }
}

export interface Tree {
  path: string;
  kb: number;
  days: number;
  branch: string;
  clean: boolean;
  unpushed: number;
  merged: boolean;
}

/** Each worktree of `repo`: size, days since its last commit, branch, and what sending it home would lose. Reads only. */
export async function listTrees(repo: string): Promise<Tree[]> {
  const names = (await treesOf(repo)) ?? [];
  const merged = new Set((await run(["gh", "pr", "list", "--state", "merged", "--limit", "1000", "--json", "headRefName", "--jq", ".[].headRefName"], repo)).split("\n").filter(Boolean));
  const dirs = names.map((n) => path.join(repo, WORKTREES, n));
  const sizes = await duKb(dirs);
  const out: Tree[] = [];
  for (const dir of dirs) {
    const branch = await run(["git", "-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
    if (!branch) continue;
    const status = await run(["git", "-C", dir, "status", "--porcelain"]);
    const unpushed = Number(await run(["git", "-C", dir, "rev-list", "--count", "HEAD", "--not", "--remotes"])) || 0;
    const mtime = (Number(await run(["git", "-C", dir, "log", "-1", "--format=%ct"])) || Date.now() / 1000) * 1000;
    out.push({ path: dir, kb: sizes.get(dir) ?? 0, days: Math.floor((Date.now() - mtime) / 86_400_000), branch, clean: status === "", unpushed, merged: merged.has(branch) });
  }
  return out.sort((a, b) => b.kb - a.kb);
}

// --- merged workers still at their desks, and a disk too full to hire on (2026-11-22) ------------------------------
// The office Mac fell to 5.7 GB free with "go home once merged" off: six workers whose PR had merged sat at their desks
// ("landed: free to go"), and the sweep above skips every seated worktree, so their 6 GB of node_modules each stayed.
// A worker at rest whose work landed now counts as an empty desk for node_modules and build output (its code stays),
// and the sweep runs on a timer, not only after a send-home. A hire under the free-space line says so instead of
// failing halfway through the checkout.

/** How often a floor sweeps on its own. */
export const SWEEP_MS = 30 * 60_000;

/** A worker as the floor lists it, as far as the sweep looks. */
export interface Desk {
  id: string;
  worktree?: { path: string };
}

/**
 * The worktree paths (absolute, under `dir`) that are still in use: every seated worker's but those `landed` names (at
 * rest, PR merged, none open: the floor's own `landedWorkers`).
 */
export function inUse(dir: string, desks: Desk[], landed: Set<string>): string[] {
  return desks.flatMap((w) => w.worktree && !landed.has(w.id) ? [path.join(dir, w.worktree.path)] : []);
}

/**
 * Sweeps `dir` every `everyMs` with the paths `live()` names in use, saying what it freed through `say`. The first look
 * waits a full interval, once the floor has its workers and pull requests (with neither, every desk would look empty).
 */
export function sweepEvery(dir: string, live: () => string[], say: (line: string) => void, everyMs = SWEEP_MS) {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void sweepFloor(dir, live()).then((line) => line && say(line)).finally(() => { busy = false; });
  }, everyMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

/** Below this much free space a hire is refused before its checkout: a worktree here plus `bun install` is about 6 GB. */
export const HIRE_FREE_GB = 15;

/** Free bytes on the volume `dir` is on (Infinity when it can't be read). */
export function freeBytes(dir: string): number {
  try { const s = statfsSync(dir); return s.bavail * s.bsize; } catch { return Infinity; }
}

/**
 * Why a hire in `dir` shouldn't start its checkout, or undefined: under `AGENT_OFFICE_HIRE_FREE_GB` (default 15, 0 turns
 * it off) free on the disk. Said in full, since the floor and office-queue show it as the hire's error.
 */
export function lowDisk(dir: string, free = freeBytes(dir), vars: Record<string, string | undefined> = process.env): string | undefined {
  const want = Number(vars.AGENT_OFFICE_HIRE_FREE_GB ?? HIRE_FREE_GB);
  if (!(want > 0) || free >= want * GB) return undefined;
  return `Only ${gb(free)} free on the disk, under the ${want} GB a hire needs, so no worktree was made. ` +
    "`office-workers home --merged` frees space (its worktrees go), and so does `bun run office:sweep`";
}
