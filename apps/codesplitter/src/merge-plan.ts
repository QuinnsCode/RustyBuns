// Layout: merge plan (#1155): the open branches in waves, by codeSplitter's own merge as the clash test
// The order to merge the open branches in, as waves. Everything in a wave merges
// together; a branch waits for the ones before it that it clashes with. Two branches clash when the
// second still merges into main by itself, but no longer once the first has landed. The test is
// codeSplitter's own merge (line ids, then the lint), not git's, so a pair it settles by itself
// doesn't hold anything up. The route is GET /api/repos/:o/:r/merge-plan (branches.ts), and
// scripts/merge-plan.ts replays real "merge main into the PR" fixes through it.
// Before a task starts, taskFiles and busyOn say which open branches already rewrite its files
// (#1163, GET .../dispatch-hint and the agent start's `busy`), so it can wait or stack on one.

import { apply, merge, type Conflict, type Doc } from "./lines.ts";
import { lintMerge } from "./lint.ts";
import type { Rule } from "./policy.ts";

/** `then` merges clean on main now, and not after `first` lands: in `files`. `stacked`: it's built on `first`. */
export interface Clash { first: string; then: string; files: string[]; stacked?: true }
/** A branch's place in the plan, and what it waits for. */
export interface Planned { branch: string; after: { branch: string; files: string[]; stacked?: true }[] }

/**
 * The waves, from the branches in the order they'd merge (the ones ready first, first) and their clashes.
 * Each branch goes one wave past the latest one it clashes with, so a branch that clashes with nothing
 * merges in the first.
 */
export function waves(order: string[], clashes: Clash[]): Planned[][] {
  const at = new Map<string, number>(), out: Planned[][] = [];
  for (const branch of order) {
    const after = clashes.filter((c) => c.then === branch && at.has(c.first))
      .map(({ first, files, stacked }) => ({ branch: first, files, ...(stacked && { stacked }) }));
    const wave = Math.max(0, ...after.map((a) => at.get(a.branch)! + 1));
    at.set(branch, wave);
    (out[wave] ??= []).push({ branch, after });
  }
  return out;
}

/** One branch's side of a file: the copy it forked from, and its copy now. */
export interface Side { base: Doc; copy: Doc }

/** codeSplitter's merge of `side` into `main`, as a branch merge runs it: what's left, and main after it if nothing is. */
function settle(path: string, main: Doc, side: Side, rule?: Rule): { conflicts: Conflict[]; after?: Doc } {
  const m = merge(side.base, side.copy, main, {}, "branch", path, "branch", rule);
  const conflicts = m.conflicts.length ? m.conflicts : lintMerge(path, main, side.copy, m);
  if (conflicts.length) return { conflicts };
  const after = structuredClone(main);
  return apply(after, m.ops, m.by, 0, main.rev).ok ? { conflicts, after } : { conflicts: [{ line: "apply", base: "", main: null, branch: null, lint: "the merge's ops don't apply to main" }] };
}

/**
 * What `then` leaves in `path` once `first` has merged into `main`. Empty when it still settles, and when
 * the clash isn't the pair's: `first` doesn't merge clean itself, or `then` already conflicts with main.
 */
export function clashIn(path: string, main: Doc, first: Side, then: Side, rule?: Rule): Conflict[] {
  const one = settle(path, main, first, rule);
  if (!one.after || settle(path, main, then, rule).conflicts.length) return [];
  return settle(path, one.after, then, rule).conflicts;
}

/**
 * A task's files before it has any edits (#1163): the repo's paths its text names, whole (`src/main.ts`)
 * or by a tail only one path ends in (`main.ts` when there's one, `two-fronts/src/main.ts` when there are
 * several). A word with no dot or slash in it names nothing, so "main" isn't `main`.
 */
export function taskFiles(task: string, paths: string[]): string[] {
  const out = new Set<string>();
  for (const raw of task.match(/[\w@.\/-]+/g) ?? []) {
    const word = raw.replace(/^\.\//, "").replace(/[.\/-]+$/, "");
    if (!/[./]/.test(word)) continue;
    const hits = paths.filter((p) => p === word || p.endsWith(`/${word}`));
    if (hits.length === 1) out.add(hits[0]!);
  }
  return [...out].sort();
}

/** An open branch already rewriting some of a new task's files. */
export interface Busy { branch: string; files: string[] }

/** The open branches that change any of `files`, the one sharing the most first: what a new task would wait for, or stack on. */
export function busyOn(files: string[], changed: { branch: string; path: string }[]): Busy[] {
  const want = new Set(files), by = new Map<string, string[]>();
  for (const c of changed) if (want.has(c.path)) by.set(c.branch, [...by.get(c.branch) ?? [], c.path]);
  return [...by].map(([branch, f]) => ({ branch, files: [...new Set(f)].sort() }))
    .sort((a, b) => b.files.length - a.files.length || a.branch.localeCompare(b.branch));
}
