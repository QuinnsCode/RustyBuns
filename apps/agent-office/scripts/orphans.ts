#!/usr/bin/env bun
// 🥐 office:orphans: worktrees that hold work nobody owns, so they never show on the floor.
//
//   bun run office:orphans          one line per worktree with unlanded work and no worker at a desk
//
// `office-workers list` only shows who is hired. A worker sent home (or lost with its office) leaves its worktree
// behind, and any commit with no merged PR or uncommitted file in it is in-progress work you cannot see. Unlanded means
// a commit `git cherry` says main lacks (squash-merges count as landed) on a branch with no merged PR, or a dirty tree.
import { $ } from "bun";
import path from "node:path";

export interface Tree { dir: string; branch: string; dirty: number; unlanded: number; pr: string }

/** One line for a worktree that holds unlanded work and has no worker, else null. */
export function orphanLine(t: Tree, owned: Set<string>): string | null {
  if (owned.has(t.branch)) return null;
  const commits = t.pr === "MERGED" ? 0 : t.unlanded;
  if (!commits && !t.dirty) return null;
  const parts = [commits && `${commits} commit${commits === 1 ? "" : "s"} not on main`, t.dirty && `${t.dirty} uncommitted`, t.pr ? `PR ${t.pr}` : "no PR"];
  return `${path.basename(t.dir)}  ${t.branch}  ${parts.filter(Boolean).join(", ")}`;
}

const out = async (cmd: ReturnType<typeof $>) => (await cmd.quiet().nothrow().text()).trim();

async function main() {
  const root = (await out($`git rev-parse --path-format=absolute --git-common-dir`)).replace(/\/\.git$/, "");
  const listed = await out($`git -C ${root} worktree list --porcelain`);
  const trees = listed.split("\n\n").map((b) => ({ dir: b.match(/^worktree (.+)$/m)?.[1] ?? "", branch: b.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? "" }))
    .filter((t) => t.branch && t.dir.includes("/.agent-office/worktrees/"));
  const owned = new Set<string>();
  try {
    const hired = JSON.parse(await out($`office-workers list --json`)) as { workers?: { branch?: unknown; status?: unknown }[] };
    for (const w of hired.workers ?? []) if (typeof w.branch === "string" && w.status !== "done") owned.add(w.branch);
  } catch { /* no office reachable: every worktree counts as unowned */ }
  const lines = await Promise.all(trees.map(async (t) => {
    const dirty = (await out($`git -C ${t.dir} status --porcelain`)).split("\n").filter(Boolean).length;
    const unlanded = (await out($`git -C ${t.dir} cherry origin/main HEAD`)).split("\n").filter((l) => l.startsWith("+")).length;
    const pr = await out($`gh pr list --head ${t.branch} --state all --json state --jq ${"[.[].state]|sort|first // \"\""}`);
    return orphanLine({ ...t, dirty, unlanded, pr }, owned);
  }));
  const found = lines.filter((l): l is string => !!l);
  console.log(found.length ? found.join("\n") : "no worktree holds unlanded work without a worker");
}

if (import.meta.main) await main();
