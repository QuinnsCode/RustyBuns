// The commit graph (#871): main's commits, newest first, with the side branches that
// merged into them. A repo's git log here walks first parents only, so a merge's other
// parent is followed up by hand until it meets main again (where that branch left it),
// a few commits at most. Each commit says whose it is: upstream's (it's in upstream's
// history, from the commit this repo last took from upstream back) or this copy's.

import type { ArtifactsRepo, CommitMeta } from "./env.ts";

/** One dot: a commit, and the lane it sits in (0 is main; a side branch's commits carry `side`, the merge they land in). */
export interface GraphCommit { hash: string; parents: string[]; message: string; author: string; at: number; up: boolean; side?: string }
export interface Graph { branch: string; commits: GraphCommit[]; more: boolean; upstream: string | null }

/** How far up a merge's other parent to walk looking for main, and how many commits in all. */
const SIDE = 20, MAX = 200;

/** What the walk found: `limit` of main's commits, newest first, each followed by the side branch it merged (if any), as git has them. */
export interface GraphRows { rows: { c: CommitMeta; side?: string }[]; known: Map<string, CommitMeta>; more: boolean }

export async function graphRows(h: Pick<ArtifactsRepo, "log" | "readCommit">, branch: string, limit = 60): Promise<GraphRows> {
  const main = await h.log({ ref: branch, limit: limit + 1 });
  const more = main.length > limit;
  main.length = Math.min(main.length, limit);
  const onMain = new Set(main.map((c) => c.hash)), known = new Map(main.map((c) => [c.hash, c]));
  const rows: { c: CommitMeta; side?: string }[] = [];
  let total = main.length;
  for (const m of main) {
    rows.push({ c: m });
    for (const p of m.parents.slice(1)) {
      // The merged branch's own commits, newest first, until it meets main (or runs out of room).
      for (let at = p, n = 0; at && !onMain.has(at) && !known.has(at) && n < SIDE && total < MAX; n++, total++) {
        const c = await h.readCommit(at).catch(() => null);
        if (!c) break;
        known.set(c.hash, c);
        rows.push({ c, side: m.hash });
        at = c.parents[0]!;
      }
    }
  }
  return { rows, known, more };
}

/** The most one request may walk, and (sharedGraph) one walk per repo and limit at a time: the cost per repo is the same however many agents ask (#1562). */
export const GRAPH_MAX = 200;
const walking = new Map<string, Promise<Graph>>();

/** commitGraph, but requests that arrive while a walk of the same repo and limit is running wait for it instead of starting their own. Nothing is kept once it ends, so a commit is seen at once. */
export function sharedGraph(key: string, walk: (limit: number) => Promise<Graph>, limit: number): Promise<Graph> {
  limit = Math.max(1, Math.min(GRAPH_MAX, limit));
  const k = `${key}\n${limit}`;
  let graph = walking.get(k);
  if (!graph) {
    graph = walk(limit).finally(() => walking.delete(k));
    walking.set(k, graph);
  }
  return graph;
}

/** `limit` of main's commits, newest first, each followed by the side branch it merged (if any). */
export async function commitGraph(h: Pick<ArtifactsRepo, "log" | "readCommit">, branch: string, upstreamCommit: string | null, limit = 60): Promise<Graph> {
  const { rows, known, more } = await graphRows(h, branch, limit);
  const up = upstreamOf(known, upstreamCommit);
  return {
    branch, more, upstream: upstreamCommit,
    commits: rows.map(({ c, side }) => ({
      hash: c.hash, parents: c.parents, message: c.message.split("\n")[0]!.slice(0, 200), author: c.author.name,
      at: c.authoredAt < 1e12 ? c.authoredAt * 1000 : c.authoredAt, up: up.has(c.hash), ...(side && { side }),
    })),
  };
}

/** The commits shown that are in upstream's history: `tip` and everything it reaches among them. */
export function upstreamOf(known: Map<string, Pick<CommitMeta, "hash" | "parents">>, tip: string | null) {
  const up = new Set<string>();
  for (const q = tip && known.has(tip) ? [tip] : []; q.length;) {
    const at = q.pop()!;
    if (up.has(at) || !known.has(at)) continue;
    up.add(at);
    q.push(...known.get(at)!.parents);
  }
  return up;
}
