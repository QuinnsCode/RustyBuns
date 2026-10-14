// Mervin's learning events (docs/mervin.md, "Learning your merge patterns"): one small, content-free event per
// merge, for a repo that turned learning on. The shape below has no field that could hold file contents or a diff;
// test/mervin-events.test.ts pins that. Imports only util.ts and types.
import type { Env } from "./env.ts";
import { sha256 } from "./util.ts";

/** What settled a file: nothing to settle, the engine's own levels, or a card answered by a person or an agent. */
export type Settled = "clean" | "engine" | "card";
/** How a card was answered; "mixed" when one file's cards were answered differently. */
export type CardAnswer = "main" | "branch" | "both" | "written" | "agent" | "mixed";

export interface OutcomeFile {
  /** The path hashed with the repo (sha256 hex), or the path itself when the repo opted out of hashing. */
  path: string;
  /** Extension with its dot, lowercased ("" for none), or the whole name for a dotfile ("lockfile" names stay useful). */
  ext: string;
  settled: Settled;
  /** The resolver level that settled it, when `settled` is "engine": how many clashes it settled with no card. */
  solved?: number;
  answer?: CardAnswer;
}

export interface OutcomeEvent {
  v: 1;
  at: number;
  repo: string;
  /** Whether the merge passed the repo's required checks (a merge they held never gets here). */
  checks_passed: boolean;
  files: OutcomeFile[];
  /** Filled in later, by a follow-up event: left null when the merge lands. */
  later: { reverted: boolean | null; edited: boolean | null };
}

/** Every key an event may hold. A new one is a decision about privacy: add it here and to the test deliberately. */
export const EVENT_KEYS = ["v", "at", "repo", "checks_passed", "files", "later"] as const;
export const FILE_KEYS = ["path", "ext", "settled", "solved", "answer"] as const;

/** A file's extension, lowercased; a dotfile or a name with none is "". */
export const extOf = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1), dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

/** How the picks for one file add up, as one answer. A written text is "written"; an object pick has `text`. */
export function answerOf(picks: Record<string, unknown> | undefined): CardAnswer | undefined {
  const kinds = new Set(Object.values(picks ?? {}).map((p) => typeof p === "object" ? "written" : String(p).startsWith("both") ? "both" : p));
  return kinds.size === 0 ? undefined : kinds.size > 1 ? "mixed" : [...kinds][0] as CardAnswer;
}

/** The event for a landed merge. `files`: what each merged file took (the picks given for it, the clashes the engine settled). */
export async function outcomeEvent(o: { owner: string; repo: string; hash: boolean; checks: boolean; files: { path: string; picks?: Record<string, unknown>; solved?: number }[]; at?: number }): Promise<OutcomeEvent> {
  const files: OutcomeFile[] = [];
  for (const f of o.files) {
    const answer = answerOf(f.picks), settled: Settled = answer ? "card" : f.solved ? "engine" : "clean";
    files.push({ path: o.hash ? await sha256(`${o.owner}/${o.repo}\n${f.path}`) : f.path, ext: extOf(f.path), settled, ...(settled === "engine" && { solved: f.solved }), ...(answer && { answer }) });
  }
  return { v: 1, at: o.at ?? Date.now(), repo: `${o.owner}/${o.repo}`, checks_passed: o.checks, files, later: { reverted: null, edited: null } };
}

/** Emit one event for a merge, if the repo turned learning on and a sink is bound. Never fails a merge. */
export async function emitOutcome(env: Env, owner: string, repo: string, files: { path: string; picks?: Record<string, unknown>; solved?: number }[]): Promise<void> {
  try {
    if (!env.MERVIN_EVENTS) return;
    const on = await env.DB.prepare("SELECT hash_paths FROM mervin_learning WHERE owner = ? AND repo = ?").bind(owner, repo).first() as { hash_paths: number } | null;
    if (!on) return;
    await env.MERVIN_EVENTS.send([await outcomeEvent({ owner, repo, hash: !!on.hash_paths, checks: true, files })]);
  } catch { /* learning never fails a merge */ }
}
