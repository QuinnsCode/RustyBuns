// Line events, the home feed's raw material (feed.ts). Main's copy of each file
// (file-do.ts) writes one as edits land, folding a writer's burst into one row.
// Who, where, how many lines and which ids, never their text.

import type { Env } from "./env.ts";
import type { Applied } from "./lines.ts";

/** One writer's edits to a file fold into one event while they keep coming this often. */
export const FOLD_MS = 10 * 60_000;
/** How far back the feed and the events go; the hourly cron drops older ones. */
export const KEEP_MS = 30 * 24 * 3600_000;
/** Line ids kept per event, so a line follow can match it. */
const IDS = 200;

/** An event still being folded into, in the file's DO: its row and the lines so far. */
export interface Recent { id: number; last: number; ids: Set<string> }

/**
 * Writes `applied` (one edit, maybe a merge's many authors) into line_events for
 * the file at `at`: each writer's ops join their open event, or start one.
 * `claim` is an agent run's, so each run is its own event.
 */
export async function recordEdits(env: Env, at: { owner: string; repo: string; path: string }, applied: Applied[], recent: Map<string, Recent>, claim?: string) {
  if (!env.DB) return;
  const byWho = new Map<string, Applied[]>();
  for (const a of applied) byWho.set(a.by, [...(byWho.get(a.by) ?? []), a]);
  for (const [who, ops] of byWho) {
    const run = who.startsWith("agent-") && claim ? claim : null;
    const key = `${who}\n${run ?? ""}`, now = ops.at(-1)!.at;
    const n = { set: 0, insert: 0, delete: 0 };
    for (const a of ops) n[a.op.kind]++;
    const open = recent.get(key);
    if (open && now - open.last < FOLD_MS) {
      for (const a of ops) open.ids.add(a.line);
      open.last = now;
      const ids = [...open.ids].slice(-IDS);
      const done = await env.DB.prepare("UPDATE line_events SET sets = sets + ?, inserts = inserts + ?, deletes = deletes + ?, lines = ?, ids = ?, last_at = ? WHERE id = ?")
        .bind(n.set, n.insert, n.delete, open.ids.size, JSON.stringify(ids), now, open.id).run();
      if (done.meta?.changes) continue;
    }
    const ids = new Set(ops.map((a) => a.line));
    const row = await env.DB.prepare("INSERT INTO line_events (owner, repo, path, who, run, sets, inserts, deletes, lines, ids, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(at.owner, at.repo, at.path, who, run, n.set, n.insert, n.delete, ids.size, JSON.stringify([...ids].slice(-IDS)), ops[0]!.at, now).first() as { id: number };
    recent.set(key, { id: row.id, last: now, ids });
  }
}

/** Drops events older than KEEP_MS (the hourly cron). */
export const sweepLineEvents = (env: Env) => env.DB.prepare("DELETE FROM line_events WHERE last_at < ?").bind(Date.now() - KEEP_MS).run();
