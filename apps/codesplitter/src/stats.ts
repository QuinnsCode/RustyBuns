// The landing page's live numbers: merges landed, and clashes Mervin settled on his own.
// D1 holds the counts (an UPDATE adds atomically); STATS (KV) holds a copy for reads, so the
// page costs one KV read a visit and D1 is read once a minute at most. Without STATS (the
// desktop before it's bound) reads go to D1. Imports only types.
import type { Env } from "./env.ts";

export interface Stats { merges: number; solved: number }

/** How long a cached read stands before the next one asks D1 again. KV's minimum is 60. */
const TTL = 60;
const KEY = "site-stats";

/** A merge landed, with `solved` clashes (a stretch both sides changed) the engine settled with no card. */
export async function countMerge(env: Env, solved: number): Promise<void> {
  try {
    const add = (name: string, n: number) => env.DB.prepare("INSERT INTO site_stats (name, n) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET n = n + excluded.n").bind(name, n);
    await env.DB.batch([add("merges", 1), ...(solved > 0 ? [add("solved", solved)] : [])]);
  } catch { /* a counter never fails a merge */ }
}

/** The counts, from the KV copy when it's fresh, else from D1 (and the copy is made again). */
export async function readStats(env: Env): Promise<Stats> {
  const cached = await env.STATS?.get(KEY, "json").catch(() => null) as Stats | null | undefined;
  if (cached) return cached;
  const rows = ((await env.DB.prepare("SELECT name, n FROM site_stats").all()).results ?? []) as { name: string; n: number }[];
  const n = (name: string) => rows.find((r) => r.name === name)?.n ?? 0;
  const stats = { merges: n("merges"), solved: n("solved") };
  await env.STATS?.put(KEY, JSON.stringify(stats), { expirationTtl: TTL }).catch(() => {});
  return stats;
}
