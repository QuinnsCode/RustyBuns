// Find Alchemy state on disk and read it into a Fleet. Bun/node fs only; the page never imports this.
//
// Alchemy's local state is `<state dir>/<stack>/<stage>/<encoded fqn>.json` (alchemy/src/State/LocalState.ts).
// Where the state dirs are:
//   - any Alchemy project: `./.alchemy/state` (or each `--state <dir>` given)
//   - Rusty Buns: every app's state is shared by all worktrees under `<git common dir>/rustybuns/alchemy/<app path>/state`
//     (packages/cli/src/state.ts), and an app's `.alchemy/state` is a symlink there. Cross-app refs add symlinked
//     stack dirs into another app's state, so stage dirs are deduped by their real path.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Fleet, Stack } from "./api.ts";
import { fqnOfFile, resourceOf } from "./read.ts";

export interface StateDir {
  dir: string;
  /** The Rusty Buns app folder it belongs to, relative to the repo (`apps/eqosys`). */
  app?: string;
}

const dirs = (d: string) => {
  try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name).sort(); }
  catch { return []; }
};
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** The repo's shared Rusty Buns state dirs: `<git common dir>/rustybuns/alchemy/**\/state`, up to four folders down. */
export function sharedStateDirs(repo: string): StateDir[] {
  const r = Bun.spawnSync(["git", "-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"], { stderr: "ignore" });
  if (r.exitCode !== 0) return [];
  const base = join(r.stdout.toString().trim(), "rustybuns", "alchemy");
  const out: StateDir[] = [];
  const walk = (d: string, depth: number) => {
    for (const name of dirs(d)) {
      const p = join(d, name);
      if (name === "state") out.push({ dir: p, app: relative(base, d) || "." });
      else if (depth < 4 && !lstatSync(p).isSymbolicLink()) walk(p, depth + 1);
    }
  };
  if (isDir(base)) walk(base, 0);
  return out;
}

/** Every stack and stage in `from`, each stage's rows read and cut down (read.ts). Sorted, so the same disk draws the same picture. */
export function scan(from: StateDir[]): Fleet {
  const seen = new Set<string>(), stacks: Stack[] = [];
  let newest = 0, files = 0;
  for (const { dir, app } of from) {
    for (const stack of dirs(dir)) {
      for (const stage of dirs(join(dir, stack))) {
        const stageDir = join(dir, stack, stage);
        let real: string;
        try { real = realpathSync(stageDir); } catch { continue; }
        if (seen.has(real) || !isDir(real)) continue;
        seen.add(real);
        const resources = [];
        for (const file of readdirSync(real).filter((f) => f.endsWith(".json") && !f.startsWith("__stack_output__")).sort()) {
          const path = join(real, file);
          let row: unknown = null, mtime = 0;
          try { mtime = statSync(path).mtimeMs; row = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
          files++;
          newest = Math.max(newest, mtime);
          const r = resourceOf(fqnOfFile(file), row, mtime);
          if (r) resources.push(r);
        }
        if (resources.length) stacks.push({ id: `${stack}/${stage}`, stack, stage, ...(app && { app }), resources });
      }
    }
  }
  stacks.sort((a, b) => a.id.localeCompare(b.id));
  return { version: `${files}-${Math.round(newest)}-${stacks.length}`, at: Date.now(), stacks };
}

/** Where to look: each `--state` dir; with none, `./.alchemy/state` and the repo's shared Rusty Buns state. */
export function stateDirsFor(cwd: string, given: string[]): StateDir[] {
  if (given.length) return given.map((dir) => ({ dir }));
  const local = join(cwd, ".alchemy", "state");
  return [...(existsSync(local) ? [{ dir: local }] : []), ...sharedStateDirs(cwd)];
}
