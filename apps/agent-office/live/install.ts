// A fresh worktree has no node_modules, so every worker's first turn spent a `bun install --frozen-lockfile` and read its
// output (#3167: 692 calls, 260k tokens in 14 days). The hire step runs it instead, and the worker starts once it is done.
import { existsSync } from "node:fs";
import path from "node:path";

/** Longest the install may hold a worker back; it starts anyway after this (a worker can still install by hand). */
export const INSTALL_MS = 120_000;

/** Whether `dir` is a Bun checkout still waiting for its install: it has a bun.lock and no node_modules. */
export function needsInstall(dir: string) {
  return (existsSync(path.join(dir, "bun.lock")) || existsSync(path.join(dir, "bun.lockb"))) && !existsSync(path.join(dir, "node_modules"));
}

/** `bun install --frozen-lockfile` in `dir`, output discarded. Resolves with what went wrong, or '' (never rejects, so a hire never fails on it). */
export async function installWorktree(dir: string, ms = INSTALL_MS, cmd: string[] = ["bun", "install", "--frozen-lockfile"]): Promise<string> {
  if (!needsInstall(dir)) return "";
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
