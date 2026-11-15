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
    await env.DB.batch([add("merges", 1), ...(solved > 0 ? [add("solved", solved), savedRow(env, hourOf(Date.now()), "branch-merge", solved)] : [])]);
  } catch { /* a counter never fails a merge */ }
}

/** What Mervin settled that, one PR at a time, would have been a conflict fought by hand. */
export type SavedKind = "do-save" | "branch-merge";
const HOUR = 3600e3;
const hourOf = (at: number) => Math.floor(at / HOUR) * HOUR;
const savedRow = (env: Env, hour: number, kind: SavedKind, n: number) =>
  env.DB.prepare("INSERT INTO conflicts_saved (hour, kind, n) VALUES (?, ?, ?) ON CONFLICT (hour, kind) DO UPDATE SET n = n + excluded.n").bind(hour, kind, n);

/** Counts saved conflicts in memory and writes them a few seconds later in one batch, so a save never waits on D1.
 *  A failed write keeps its counts for the next one. */
export class ConflictSavedCounter {
  private pending = new Map<string, { hour: number; kind: SavedKind; n: number }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private env: Env, private wait = 1000) {}

  add(kind: SavedKind, n = 1, at = Date.now()) {
    if (n <= 0 || !this.env.DB) return;
    const hour = hourOf(at), key = `${hour} ${kind}`, row = this.pending.get(key);
    if (row) row.n += n; else this.pending.set(key, { hour, kind, n });
    this.timer ??= setTimeout(() => void this.flush(), this.wait);
  }

  async flush() {
    this.timer = null;
    const rows = [...this.pending.values()];
    this.pending.clear();
    if (!rows.length) return;
    try {
      await this.env.DB.batch(rows.map((r) => savedRow(this.env, r.hour, r.kind, r.n)));
    } catch (e) {
      for (const r of rows) this.add(r.kind, r.n, r.hour);
      console.error("codeSplitter: conflicts-saved count failed", String((e as Error)?.message ?? e));
    }
  }
}

/** Saved conflicts per hour and kind since `since` (ms), oldest first: what the office's daily ledger reads. */
export async function readSaved(env: Env, since: number): Promise<{ hour: number; kind: string; n: number }[]> {
  return (await env.DB.prepare("SELECT hour, kind, n FROM conflicts_saved WHERE hour >= ? ORDER BY hour LIMIT 5000").bind(since).all<{ hour: number; kind: string; n: number }>()).results ?? [];
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
