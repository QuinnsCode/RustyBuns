// What sent-home workers leave on disk, swept by rules that can only hit what nobody uses (#3325).
//
// On 2026-11-03 the office Mac's disk filled to 36 MB free. Two things grow and nothing trimmed them:
//  1. Claude Code's scratch, /private/tmp/claude-<uid>/<slug of the session's directory>. Sending a worker home deletes its
//     worktree but not this folder. A folder goes only when its slug is `<repo>/.agent-office/worktrees/<name>` for a repo
//     we know, that repo's worktrees folder exists, and no worktree in it is <name> (or a parent of it, for a session
//     started in a subfolder). Anything that doesn't parse stays. The office runs it on start and after each send-home.
//  2. Bun's cache, ~/.bun/install/cache, which keeps every version ever downloaded. `pruneBunCache` keeps what any
//     bun.lock in a live checkout or worktree names and removes other `name@version@@@N` folders. Manual, dry run first.
// Plus, for `bun run office:sweep`: the other package caches, through each tool's own command, and a list of worktrees
// still on disk with what sending each home would lose (sending home is the owner's call, so this never deletes one).
import { existsSync, realpathSync } from "node:fs";
import { lstat, readdir, readFile, readlink, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

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

/** The office's hook: sweep one floor's repo, and say what it freed in one line ('' when nothing). */
export async function sweepFloor(dir: string): Promise<string> {
  try {
    // Claude names the folder from the path as the worker was started, which may or may not have its symlinks resolved
    const r = await sweepScratch([...new Set([dir, realpathSync(dir)])], true);
    return r.paths.length ? `🧹 Swept ${r.paths.length} scratch folder${r.paths.length === 1 ? "" : "s"} of gone worktrees, ${gb(r.bytes)} freed` : "";
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
    { name: "Playwright", dir: path.join(lib, "ms-playwright") },
    { name: "Google", dir: path.join(lib, "Google") },
    { name: "VS Code updater", dir: path.join(lib, "com.microsoft.VSCode.ShipIt") },
  ];
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
