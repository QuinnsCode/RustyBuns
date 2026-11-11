// What's new on codeSplitter for each office board, shared by the office's route (server.ts) and the page (index.ts).
// Each board has a codeSplitter twin: 📌 issues ↔ a check failing on main, 📋 queue ↔ the repo's coding-agent runs,
// 🔀 PRs ↔ its branches. A board's latest has a stamp; the dot shows while the stamp isn't the one you last saw.

import { arr, nul, num, obj, opt, str, type Of } from "@rustybuns/util/guard";

export const BOARDS = ["issues", "queue", "pulls"] as const;
export type Board = (typeof BOARDS)[number];
const Latest = obj({ stamp: str(Infinity), text: str(Infinity) });
export const Summary = obj({ issues: nul(Latest), queue: nul(Latest), pulls: nul(Latest) });
export type Summary = Of<typeof Summary>;
/** GET /__rb/codesplitter?repo=: where codeSplitter is, and each board's latest (null when it can't say). */
export const News = obj({ site: str(2000), boards: nul(Summary) });

const at = num(0, Number.MAX_SAFE_INTEGER), name = str(500);
/** codeSplitter's GET /api/repos/:repo/branches, /checks and /agents, the fields the boards read. */
export const Branches = arr(obj({ name, by: name, status: name, created_at: at, merged_by: opt(name), merged_at: opt(at) }), 10_000);
export type Branch = Of<typeof Branches>[number];
export const Checks = obj({ runs: arr(obj({ id: at, name, status: name, finished_at: opt(at), created_at: at }), 10_000) });
export type CheckRun = Of<typeof Checks>["runs"][number];
export const AgentRuns = arr(obj({ id: at, agent: name, status: name, task: str(Infinity) }), 10_000);
export type AgentRun = Of<typeof AgentRuns>[number];

const newest = <T,>(xs: T[], at: (x: T) => number) => xs.reduce<T | undefined>((a, x) => (!a || at(x) > at(a) ? x : a), undefined);

/** Each board's latest from the repo's branches, main's checks and agent runs (newest first); null where there's none. */
export function summarize(branches: Branch[] | null, checks: CheckRun[] | null, runs: AgentRun[] | null): Summary {
  const b = newest(branches ?? [], (x) => Math.max(x.created_at, x.merged_at ?? 0));
  const failed = newest((checks ?? []).filter((c) => c.status === "failed"), (c) => c.finished_at ?? c.created_at);
  const run = runs?.[0];
  return {
    issues: failed ? { stamp: `check:${failed.id}`, text: `${failed.name} failed on main` } : null,
    queue: run ? { stamp: `run:${run.id}:${run.status}`, text: `${run.agent} ${run.status}: ${run.task}` } : null,
    pulls: b ? {
      stamp: `branch:${b.name}:${b.status}`,
      text: b.status === "merged" ? `${b.name} merged by ${b.merged_by ?? b.by}` : `${b.name} opened by ${b.by}`,
    } : null,
  };
}

/**
 * The boards with something you haven't seen, and `seen` brought up to date for a board seen for the first time, so
 * turning this on doesn't light every dot for what was already there. A board with nothing on it is seen as "", so
 * the first thing to land on it is news.
 */
export function fresh(s: Summary, seen: Partial<Record<Board, string>>): { boards: Board[]; seen: Partial<Record<Board, string>> } {
  const next = { ...seen };
  const boards: Board[] = [];
  for (const k of BOARDS) {
    const l = s[k];
    if (next[k] === undefined) next[k] = l?.stamp ?? "";
    else if (l && next[k] !== l.stamp) boards.push(k);
  }
  return { boards, seen: next };
}
