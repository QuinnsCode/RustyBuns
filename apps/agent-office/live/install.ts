// A fresh worktree has no node_modules, so every worker's first turn spent a `bun install --frozen-lockfile` and read its
// output (#3167: 692 calls, 260k tokens in 14 days). The hire step runs it instead, and the worker starts once it is done.
//
// #5656: that install wrote ~250k files per hire and send-home deleted them again, and the file events fed fseventsd to
// 27 GB. So a worktree's root node_modules is renamed into a pool on its way out (`poolModules`), and the next hire renames
// one back in (`adoptModules`) before the install, which then has next to nothing to do. One rename each way, same disk.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";

/** Longest the install may hold a worker back; it starts anyway after this (a worker can still install by hand). */
export const INSTALL_MS = 120_000;

/** How many node_modules the pool keeps; a third pushes out the oldest. */
export const POOL_MAX = 2;

/** Whether `dir` is a Bun checkout still waiting for its install: it has a bun.lock and no node_modules. */
export function needsInstall(dir: string) {
  return (existsSync(path.join(dir, "bun.lock")) || existsSync(path.join(dir, "bun.lockb"))) && !existsSync(path.join(dir, "node_modules"));
}

/**
 * The pool for an office worktree (`<repo>/.agent-office/worktrees/<name>`): `<repo>/.agent-office/node-pool`, on the
 * same disk so a rename is one move. Undefined for any other folder (a workspace's nested repo, a checkout elsewhere).
 */
export function poolFor(tree: string): string | undefined {
  const parent = path.dirname(path.resolve(tree));
  if (path.basename(parent) !== "worktrees" || path.basename(path.dirname(parent)) !== ".agent-office") return undefined;
  return path.join(path.dirname(parent), "node-pool");
}

/** A short hash of the worktree's lockfile, which names its pooled copy; undefined without one. */
export function lockKey(tree: string): string | undefined {
  for (const f of ["bun.lock", "bun.lockb"]) {
    try { return new Bun.CryptoHasher("sha256").update(readFileSync(path.join(tree, f))).digest("hex").slice(0, 16); } catch {}
  }
  return undefined;
}

/** The pool's entries (`<key>-<ms>`, each holding a `node_modules`), newest first. */
async function entries(pool: string): Promise<{ name: string; key: string; at: number }[]> {
  let names: string[];
  try { names = await readdir(pool); } catch { return []; }
  return names.flatMap((name) => {
    const m = /^([0-9a-f]{16})-(\d+)$/.exec(name);
    return m ? [{ name, key: m[1]!, at: Number(m[2]) }] : [];
  }).sort((a, b) => b.at - a.at);
}

/**
 * Moves `tree`'s root node_modules into its pool instead of letting it be deleted. A copy for another lockfile is
 * dropped (the lockfile moved on), and so is any past the newest `POOL_MAX`; those deletes run in the background.
 * Resolves whether it moved; never throws.
 */
export async function poolModules(tree: string, now = Date.now()): Promise<boolean> {
  const pool = poolFor(tree), key = lockKey(tree), modules = path.join(tree, "node_modules");
  if (!pool || !key || !existsSync(modules)) return false;
  try {
    const dir = path.join(pool, `${key}-${now}`);
    await mkdir(dir, { recursive: true });
    try { await rename(modules, path.join(dir, "node_modules")); } catch (err) { await rmdir(dir).catch(() => {}); throw err; }
  } catch { return false; }
  const all = await entries(pool);
  const keep = new Set(all.filter((e) => e.key === key).slice(0, POOL_MAX).map((e) => e.name));
  // renamed out of the pool's names first, so a hire can't take one half deleted
  for (const e of all) {
    if (keep.has(e.name)) continue;
    const gone = path.join(pool, `gone-${e.name}`);
    if (await rename(path.join(pool, e.name), gone).then(() => true, () => false)) void rm(gone, { recursive: true, force: true }).catch(() => {});
  }
  return true;
}

/**
 * Moves a pooled node_modules into `tree`, which has none: one for the same lockfile first, else the newest (the
 * install that follows changes the few packages that differ). Two hires at once can't take the same one: the second
 * rename fails and it tries the next. Resolves whether one moved in; never throws.
 */
export async function adoptModules(tree: string): Promise<boolean> {
  const pool = poolFor(tree), key = lockKey(tree), modules = path.join(tree, "node_modules");
  if (!pool || !key || existsSync(modules)) return false;
  const all = await entries(pool);
  for (const e of [...all.filter((x) => x.key === key), ...all.filter((x) => x.key !== key)]) {
    try {
      await rename(path.join(pool, e.name, "node_modules"), modules);
      await rmdir(path.join(pool, e.name)).catch(() => {});
      return true;
    } catch {}
  }
  return false;
}

/**
 * `bun install --frozen-lockfile` in `dir`, output discarded, after moving in a pooled node_modules when there is one.
 * Resolves with what went wrong, or '' (never rejects, so a hire never fails on it).
 */
export async function installWorktree(dir: string, ms = INSTALL_MS, cmd: string[] = ["bun", "install", "--frozen-lockfile"]): Promise<string> {
  if (!needsInstall(dir)) return "";
  await adoptModules(dir);
  try {
    const proc = Bun.spawn(cmd, { cwd: dir, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    const timer = setTimeout(() => proc.kill(), ms);
    const code = await proc.exited;
    clearTimeout(timer);
    return code === 0 ? "" : `bun install exited ${code}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
