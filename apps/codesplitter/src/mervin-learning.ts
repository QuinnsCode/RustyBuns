// Mervin learning (docs/mervin.md, "Learning your merge patterns"): off until a repo's owner turns it on. While on,
// each merged file leaves one small event (extension, hashed path, settled or asked): no contents, no diffs.
// The weekly report reads them back. Deleting the data removes every event. Nothing here changes how a merge is computed.
import type { Env } from "./env.ts";
import { sha256 } from "./util.ts";

export type Outcome = "settled" | "asked" | "wrong";
/** `answer`: how the card was answered ("main" | "branch" | "both" | "written" | "agent" | "mixed"), for an asked file. */
export interface Event { path: string; outcome: Outcome; answer?: string }

/** How a card's picks for one file add up, as one answer; "written" for a text, "mixed" when they differ. */
export function answerOf(picks: Record<string, unknown> | undefined): string | undefined {
  const kinds = new Set(Object.values(picks ?? {}).map((p) => typeof p === "object" ? "written" : String(p).startsWith("both") ? "both" : String(p)));
  return kinds.size === 0 ? undefined : kinds.size > 1 ? "mixed" : [...kinds][0];
}

/** What an event stores for a path: its hash with the repo, or the path itself when the repo turned hashing off. */
export const pathKey = async (owner: string, repo: string, path: string, hash = true): Promise<string> =>
  hash ? (await sha256(`${owner}/${repo}:${path}`)).slice(0, 16) : path;

/** Whether the repo hashes paths in its events (the default); false when it opted out. */
export const hashesPaths = async (env: Env, owner: string, repo: string): Promise<boolean> =>
  ((await env.DB.prepare("SELECT hash_paths FROM mervin_learning WHERE owner = ? AND repo = ?").bind(owner, repo).first()) as { hash_paths: number } | null)?.hash_paths !== 0;

const WEEK = 7 * 24 * 3600 * 1000;
/** A path asked this many times in the week is worth a .gitattributes rule for a person to approve. */
const RULE_AT = 3;

export const learningOn = async (env: Env, owner: string, repo: string): Promise<boolean> =>
  !!(await env.DB.prepare("SELECT 1 AS x FROM mervin_learning WHERE owner = ? AND repo = ?").bind(owner, repo).first());

export async function setLearning(env: Env, owner: string, repo: string, on: boolean, hashPaths?: boolean): Promise<void> {
  await (on
    ? env.DB.prepare("INSERT INTO mervin_learning (owner, repo, since, hash_paths) VALUES (?, ?, ?, ?) ON CONFLICT (owner, repo) DO UPDATE SET hash_paths = COALESCE(?, hash_paths)")
      .bind(owner, repo, Date.now(), hashPaths === false ? 0 : 1, hashPaths === undefined ? null : hashPaths ? 1 : 0)
    : env.DB.prepare("DELETE FROM mervin_learning WHERE owner = ? AND repo = ?").bind(owner, repo)).run();
}

/** Delete every event kept for the repo; answers how many. (No salt is kept: a path's key is its hash with the repo's name.) */
export async function deleteLearning(env: Env, owner: string, repo: string): Promise<number> {
  const r = await env.DB.prepare("DELETE FROM mervin_events WHERE owner = ? AND repo = ?").bind(owner, repo).run();
  return r.meta?.changes ?? 0;
}

/** A merge landed: keep its events, if the repo opted in. Never fails the merge. */
export async function recordEvents(env: Env, owner: string, repo: string, events: Event[]): Promise<void> {
  try {
    if (!events.length || !(await learningOn(env, owner, repo))) return;
    const at = Date.now(), hash = await hashesPaths(env, owner, repo);
    const rows = await Promise.all(events.map(async (e) => {
      const base = e.path.split("/").pop() ?? "";
      const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase().slice(0, 12) : "";
      return env.DB.prepare("INSERT INTO mervin_events (owner, repo, ext, path_hash, outcome, answer, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(owner, repo, ext, await pathKey(owner, repo, e.path, hash), e.outcome, e.answer ?? "", at);
    }));
    await env.DB.batch(rows);
  } catch { /* learning never fails a merge */ }
}

/** The last week, per repo: what was settled, asked, wrong; the paths that fought most; the rules worth proposing. */
export async function report(env: Env, owner: string, repo: string) {
  const since = Date.now() - WEEK;
  const q = async <T>(sql: string) => ((await env.DB.prepare(sql).bind(owner, repo, since).all()).results ?? []) as T[];
  const counts = await q<{ outcome: Outcome; n: number }>("SELECT outcome, COUNT(*) AS n FROM mervin_events WHERE owner = ? AND repo = ? AND at >= ? GROUP BY outcome");
  const n = (o: Outcome) => counts.find((c) => c.outcome === o)?.n ?? 0;
  const fighting = await q<{ path_hash: string; ext: string; asked: number }>(
    "SELECT path_hash, ext, COUNT(*) AS asked FROM mervin_events WHERE owner = ? AND repo = ? AND at >= ? AND outcome = 'asked' GROUP BY path_hash, ext ORDER BY asked DESC, path_hash LIMIT 5");
  return {
    days: 7, settled: n("settled"), asked: n("asked"), wrong: n("wrong"),
    fighting, rules_proposed: fighting.filter((f) => f.asked >= RULE_AT).length,
  };
}

/** What the repo page and GET /api/repos/:o/:r/mervin show. */
export async function learningState(env: Env, owner: string, repo: string) {
  const on = await learningOn(env, owner, repo);
  return { learning: on, ...(on && { hash_paths: await hashesPaths(env, owner, repo) }), ...(on && { report: await report(env, owner, repo) }) };
}
