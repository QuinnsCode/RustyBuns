// "Help improve your git experience": a person who owns a private repo is asked once whether codeSplitter
// may keep how their merge conflicts go, so agents get better at settling them. Public repos are visible
// anyway; private ones are the owner's, so they are asked, and nothing is kept until they say yes
// (PUT /api/me {share_usage: true|false}, users.share_usage: NULL not asked, 1 yes, 0 no).
//
// What is kept is a row per conflict an agent was asked about (conflict_outcomes): the file's extension, the
// round, who answered, whether the answer held up. No paths, no repo names, no code. It is theirs to take
// (/api/me/export) and bury (account delete). Admins read it summed: GET /api/admin/insights `conflicts`.

import type { Env } from "./env.ts";

const YEAR = 365 * 86_400_000;

/** The extension of a path, lowercased; a lockfile is just "lock". Nothing else of the path is kept. */
export function extOf(path: string) {
  const file = path.split("/").pop() ?? "";
  if (/lock/i.test(file)) return "lock";
  const i = file.lastIndexOf(".");
  return i > 0 ? file.slice(i).toLowerCase().slice(0, 12) : "";
}

/** Whether `name` still has to be asked: they own a private repo and haven't answered. */
export async function askUsage(env: Env, name: string) {
  const row = await env.DB.prepare(`SELECT share_usage IS NULL AND EXISTS (SELECT 1 FROM repos WHERE owner = users.name AND visibility = 'private') AS ask FROM users WHERE name = ?`).bind(name).first() as { ask: number } | null;
  return !!row?.ask;
}

/** Note how a conflict went, if the repo's owner said yes. Never throws: a note must not fail a merge. */
export async function noteConflict(env: Env, owner: string, path: string, o: { round: number; who: string; harness?: string; ok?: boolean; tests?: string }) {
  try {
    await env.DB.prepare(`INSERT INTO conflict_outcomes (name, at, ext, round, who, harness, ok, tests)
      SELECT name, ?, ?, ?, ?, ?, ?, ? FROM users WHERE name = ? AND share_usage = 1`)
      .bind(Date.now(), extOf(path), o.round, o.who, o.harness ?? null, o.ok === undefined ? null : o.ok ? 1 : 0, o.tests ?? null, owner).run();
  } catch (e) { console.error("codeSplitter: noting a conflict failed", String((e as Error)?.message ?? e)); }
}

/** Forget what a person who said no (or changed their mind) shared. */
export const forget = (env: Env, name: string) => env.DB.prepare("DELETE FROM conflict_outcomes WHERE name = ?").bind(name);

/** The hourly sweep. */
export const sweepConflicts = (env: Env, now = Date.now()) => env.DB.prepare("DELETE FROM conflict_outcomes WHERE at < ?").bind(now - YEAR).run();

/** What admins see: how agent answers to conflicts are doing, by extension and by round. Summed, nobody named. */
export async function conflictStats(env: Env) {
  const all = async (sql: string) => (await env.DB.prepare(sql).all()).results as Record<string, any>[];
  return {
    people: Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE share_usage = 1").first())?.n ?? 0),
    asked: Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE share_usage IS NOT NULL").first())?.n ?? 0),
    by_ext: await all("SELECT ext, COUNT(*) AS n, SUM(ok = 1) AS held, SUM(who = 'escalate') AS to_person FROM conflict_outcomes GROUP BY ext ORDER BY n DESC LIMIT 12"),
    by_round: await all("SELECT MIN(round, 4) AS round, COUNT(*) AS n, SUM(ok = 1) AS held, SUM(who = 'escalate') AS to_person FROM conflict_outcomes GROUP BY MIN(round, 4) ORDER BY round"),
    // A week by hour of day, for the heatmap: when conflicts happen.
    by_hour: await all("SELECT CAST(strftime('%w', at / 1000, 'unixepoch') AS INTEGER) AS dow, CAST(strftime('%H', at / 1000, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS n FROM conflict_outcomes GROUP BY dow, hour"),
  };
}
