// Layout: Mervin learning (#1511): the repo's D1 events in, plan weights and rule suggestions out
// Design: docs/mervin.md "Learning your merge patterns". Queries over `mervin_events` (the one store, written by
// mervin-learning.ts) and pure functions over their rows. Nothing here changes how a merge is computed: it only
// orders a plan's tie-breaks and proposes rules.
import type { Env } from "./env.ts";

export interface FightRow { ext: string; path_hash?: string; fights: number }
export interface AnswerRow { path_hash: string; answer: "main" | "branch" | "both" | "agent" | "written"; n: number }

/** How often each extension and path ended in a card on this repo. */
export async function fightRows(env: Env, owner: string, repo: string): Promise<FightRow[]> {
  const r = await env.DB.prepare("SELECT ext, path_hash, COUNT(*) AS fights FROM mervin_events WHERE owner = ? AND repo = ? AND outcome = 'asked' GROUP BY ext, path_hash").bind(owner, repo).all();
  return (r.results ?? []) as unknown as FightRow[];
}

/** The card answers given per path, written ones left out: a text isn't a choice that repeats. */
export async function answerRows(env: Env, owner: string, repo: string): Promise<AnswerRow[]> {
  const r = await env.DB.prepare("SELECT path_hash, answer, COUNT(*) AS n FROM mervin_events WHERE owner = ? AND repo = ? AND outcome = 'asked' AND answer != '' AND answer != 'written' GROUP BY path_hash, answer").bind(owner, repo).all();
  return (r.results ?? []) as unknown as AnswerRow[];
}

/** A path's card answer repeats when this many answers agree and make up this share of its answers. */
export const MIN_REPEATS = 3;
export const MIN_SHARE = 0.8;

/** Fights per extension and per path: how often it ended in a card on this repo. */
export function fightWeights(rows: FightRow[]): { ext: Map<string, number>; path: Map<string, number> } {
  const ext = new Map<string, number>(), path = new Map<string, number>();
  for (const r of rows) {
    ext.set(r.ext, (ext.get(r.ext) ?? 0) + r.fights);
    if (r.path_hash) path.set(r.path_hash, (path.get(r.path_hash) ?? 0) + r.fights);
  }
  return { ext, path };
}

const extOf = (p: string) => { const m = /\.([^./]+)$/.exec(p); return m ? m[1]!.toLowerCase() : ""; };

/** How much a branch's files have fought here: the path's own count (by `key`, the stored hash), else its extension's. */
export function branchWeight(files: string[], w: ReturnType<typeof fightWeights>, key: (p: string) => string = (p) => p): number {
  return files.reduce((sum, f) => sum + (w.path.get(key(f)) ?? w.ext.get(extOf(f)) ?? 0), 0);
}

/**
 * The merge order with the fight-prone branches last among equals. `order` stays the order (ready first); only
 * a branch whose files fight more moves after a calmer one that was behind it by at most `slack` places, so a
 * plan never jumps far from the deterministic one. With no history the order comes back unchanged.
 */
export function weightOrder(order: string[], files: Map<string, string[]>, w: ReturnType<typeof fightWeights>, key: (p: string) => string = (p) => p, slack = 1): string[] {
  const score = (b: string) => branchWeight(files.get(b) ?? [], w, key);
  const out = [...order];
  for (let i = 0; i < out.length - 1; i++) {
    const b = out[i]!;
    if (score(b) > score(out[i + 1]!) && i - order.indexOf(b) < slack) [out[i], out[i + 1]] = [out[i + 1]!, b];
  }
  return out;
}

export interface Suggestion { path_hash: string; answer: "main" | "branch" | "both"; n: number; rule: string }

const ATTR = { main: "merge=ours", branch: "merge=theirs", both: "merge=union" } as const;

/** Card answers that repeat, per stored path key: `rule` is the attribute to put after the path in `.gitattributes`, for a person to approve. */
export function suggestions(rows: AnswerRow[]): Suggestion[] {
  const by = new Map<string, AnswerRow[]>();
  for (const r of rows) if (r.answer in ATTR) by.set(r.path_hash, [...by.get(r.path_hash) ?? [], r]);
  const total = new Map<string, number>();
  for (const r of rows) total.set(r.path_hash, (total.get(r.path_hash) ?? 0) + r.n);
  const out: Suggestion[] = [];
  for (const [path_hash, rs] of by) {
    const top = rs.reduce((a, b) => (b.n > a.n ? b : a));
    if (top.n >= MIN_REPEATS && top.n / total.get(path_hash)! >= MIN_SHARE) {
      const answer = top.answer as Suggestion["answer"];
      out.push({ path_hash, answer, n: top.n, rule: ATTR[answer] });
    }
  }
  return out.sort((a, b) => b.n - a.n || a.path_hash.localeCompare(b.path_hash));
}
