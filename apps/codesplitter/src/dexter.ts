// Dexter in codeSplitter, opt in per repo (#3923; the owner chose plain rows plus a cap). While a repo's owner has him on,
// each agent run it hosts reports its token use once, at its end: what claude's stream-json said, read by the same `tally`
// the office's Dexter reads transcripts with (@rustybuns/util/dexter). Never the transcript text, only the numbers.
// He shows the week per tool, and proposes trims to the repo's AGENTS.md and CLAUDE.md as a diff; approving one puts it
// on a branch as agent-dexter, which a person reviews and merges like any other. Switching him off deletes every row.
//
//   GET  /api/repos/:o/:r/dexter               on?, and while on: the last 7 days per tool, 30 days of the rollup, the trims
//   PUT  /api/repos/:o/:r/dexter               {on}: the owner switches him on, or off (off deletes the repo's rows)
//   POST /api/repos/:o/:r/dexter/trims         the crew asks for trims: one open diff per standing file that has any
//   POST /api/repos/:o/:r/dexter/trims/:id     {approve}: approve puts the cut on a branch dexter-trims-<id>; false declines it
//
// Kept (sweepDexter, the hourly cron): runs and tools 30 days and the newest CAP runs per repo; the dexter_days rollup a
// year; a decided trim 90 days. An open trim stays until someone decides it.

import { fail, json, need, readBody, type Env } from "./env.ts";
import { bool, obj } from "@rustybuns/util/guard";
import { familyOf, tip, trimDiff, units, type Report } from "@rustybuns/util/dexter";
import { docIn } from "./archive.ts";
import { diffToOps } from "./sync.ts";
import type { Call } from "./deps.ts";

const DAY = 24 * 3600 * 1000;
/** Raw runs and tools are kept this long, the rollup a year, a decided trim 90 days. */
export const KEEP = { raw: 30 * DAY, days: 365 * DAY, trims: 90 * DAY } as const;
/** The newest runs kept per repo, on top of the 30 days: one D1 database holds every repo, and tops out at 10 GB. */
export const CAP = 5000;
/** The standing text every session in the repo pays for. */
export const STANDING = ["AGENTS.md", "CLAUDE.md"] as const;
/** The rollup's row for a day's runs as a whole: calls are turns, tokens every token read and written. */
const ALL = "(runs)";
const AGENT = "agent-dexter";

const ON = obj({ on: bool() });
const DECIDE = obj({ approve: bool() });

export const dexterOn = async (env: Env, owner: string, repo: string): Promise<boolean> =>
  !!(await env.DB.prepare("SELECT 1 AS x FROM dexter_repos WHERE owner = ? AND repo = ?").bind(owner, repo).first());

/** On keeps a row from now; off deletes the repo's rows in every Dexter table. */
export async function setDexter(env: Env, owner: string, repo: string, on: boolean, now = Date.now()): Promise<void> {
  if (on) {
    await env.DB.prepare("INSERT INTO dexter_repos (owner, repo, since) VALUES (?, ?, ?) ON CONFLICT (owner, repo) DO NOTHING").bind(owner, repo, now).run();
    return;
  }
  const where = "WHERE owner = ? AND repo = ?";
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM dexter_tools WHERE run_id IN (SELECT id FROM dexter_runs ${where})`).bind(owner, repo),
    ...["dexter_runs", "dexter_days", "dexter_trims", "dexter_repos"].map((t) => env.DB.prepare(`DELETE FROM ${t} ${where}`).bind(owner, repo)),
  ]);
}

/** The family that spent most in a run ("opus"), or "other". */
const modelOf = (r: Report) => [...r.models ?? []].sort((a, b) => b[1] - a[1])[0]?.[0] ?? familyOf();

/** An agent run ended: keep its numbers, if the repo has Dexter on. Never fails the run. */
export async function recordRun(env: Env, owner: string, repo: string, run: string, r: Report | undefined, now = Date.now()): Promise<void> {
  try {
    if (!r?.turns || !(await dexterOn(env, owner, repo))) return;
    const row = await env.DB.prepare("INSERT INTO dexter_runs (owner, repo, run, model, at, input, output, cache_read, cache_write, turns) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(owner, repo, run, modelOf(r), now, r.usage.input, r.usage.output, r.usage.cacheRead, r.usage.cacheWrite, r.turns).first<{ id: number }>();
    if (!row || !r.tools.size) return;
    await env.DB.batch([...r.tools].map(([tool, t]) => env.DB.prepare("INSERT INTO dexter_tools (run_id, tool, calls, tokens, worst) VALUES (?, ?, ?, ?, ?)").bind(row.id, tool, t.calls, t.tokens, t.worst)));
  } catch { /* Dexter never fails a run */ }
}

interface Trim { id: number; file: string; diff: string; saved: number; status: "open" | "approved" | "declined"; at: number; decided_by: string | null; decided_at: number | null; branch: string | null }

const trims = async (env: Env, owner: string, repo: string) =>
  (await env.DB.prepare("SELECT id, file, diff, saved, status, at, decided_by, decided_at, branch FROM dexter_trims WHERE owner = ? AND repo = ? ORDER BY id DESC LIMIT 20").bind(owner, repo).all<Trim>()).results;

/** What the page shows: whether he's on, and while on the last week per tool, 30 days of the rollup, and the trims. */
export async function dexterState(env: Env, owner: string, repo: string, now = Date.now()) {
  const on = await env.DB.prepare("SELECT since FROM dexter_repos WHERE owner = ? AND repo = ?").bind(owner, repo).first<{ since: number }>();
  if (!on) return { on: false as const };
  const since = now - 7 * DAY;
  const u = await env.DB.prepare("SELECT COUNT(*) AS runs, COALESCE(SUM(input), 0) AS input, COALESCE(SUM(output), 0) AS output, COALESCE(SUM(cache_read), 0) AS cache_read, COALESCE(SUM(cache_write), 0) AS cache_write, COALESCE(SUM(turns), 0) AS turns FROM dexter_runs WHERE owner = ? AND repo = ? AND at >= ?")
    .bind(owner, repo, since).first<{ runs: number; input: number; output: number; cache_read: number; cache_write: number; turns: number }>();
  const { results: tools } = await env.DB.prepare(`SELECT t.tool, SUM(t.calls) AS calls, SUM(t.tokens) AS tokens, MAX(t.worst) AS worst FROM dexter_tools t JOIN dexter_runs r ON r.id = t.run_id
    WHERE r.owner = ? AND r.repo = ? AND r.at >= ? GROUP BY t.tool ORDER BY tokens DESC LIMIT 10`).bind(owner, repo, since).all<{ tool: string; calls: number; tokens: number; worst: number }>();
  const { results: days } = await env.DB.prepare("SELECT day, runs, calls AS turns, tokens FROM dexter_days WHERE owner = ? AND repo = ? AND tool = ? AND day >= ? ORDER BY day")
    .bind(owner, repo, ALL, new Date(now - 30 * DAY).toISOString().slice(0, 10)).all<{ day: string; runs: number; turns: number; tokens: number }>();
  const usage = { input: u?.input ?? 0, output: u?.output ?? 0, cacheRead: u?.cache_read ?? 0, cacheWrite: u?.cache_write ?? 0 };
  return {
    on: true as const, since: on.since,
    week: { runs: u?.runs ?? 0, turns: u?.turns ?? 0, ...usage, units: Math.round(units(usage)), tools: tools.map((t) => ({ ...t, tip: tip(t.tool) })) },
    days, trims: await trims(env, owner, repo),
  };
}

/** The hourly sweep: today's and yesterday's rollup from the raw rows, then what's past its keep, then each repo past CAP runs. */
export async function sweepDexter(env: Env, now = Date.now(), cap = CAP): Promise<void> {
  const from = Math.floor(now / DAY) * DAY - DAY;
  const day = "date(r.at / 1000, 'unixepoch')";
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO dexter_days (owner, repo, day, tool, calls, tokens, runs)
      SELECT r.owner, r.repo, ${day} AS d, t.tool, SUM(t.calls), SUM(t.tokens), COUNT(DISTINCT r.id) FROM dexter_runs r JOIN dexter_tools t ON t.run_id = r.id WHERE r.at >= ? GROUP BY r.owner, r.repo, d, t.tool
      ON CONFLICT (owner, repo, day, tool) DO UPDATE SET calls = excluded.calls, tokens = excluded.tokens, runs = excluded.runs`).bind(from),
    env.DB.prepare(`INSERT INTO dexter_days (owner, repo, day, tool, calls, tokens, runs)
      SELECT r.owner, r.repo, ${day} AS d, ?, SUM(r.turns), SUM(r.input + r.output + r.cache_read + r.cache_write), COUNT(*) FROM dexter_runs r WHERE r.at >= ? GROUP BY r.owner, r.repo, d
      ON CONFLICT (owner, repo, day, tool) DO UPDATE SET calls = excluded.calls, tokens = excluded.tokens, runs = excluded.runs`).bind(ALL, from),
    env.DB.prepare("DELETE FROM dexter_runs WHERE at < ?").bind(now - KEEP.raw),
    env.DB.prepare("DELETE FROM dexter_runs WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY owner, repo ORDER BY id DESC) AS n FROM dexter_runs) WHERE n > ?)").bind(cap),
    env.DB.prepare("DELETE FROM dexter_tools WHERE run_id NOT IN (SELECT id FROM dexter_runs)"),
    env.DB.prepare("DELETE FROM dexter_days WHERE day < ?").bind(new Date(now - KEEP.days).toISOString().slice(0, 10)),
    env.DB.prepare("DELETE FROM dexter_trims WHERE status != 'open' AND decided_at < ?").bind(now - KEEP.trims),
  ]);
}

const fileQ = (path: string, branch?: string) => `?path=${encodeURIComponent(path)}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`;

/** Each standing file on main with something to cut gets one open trim; one whose open trim says the same is left be. */
async function propose(env: Env, call: Call, owner: string, repo: string, now: number): Promise<void> {
  for (const file of STANDING) {
    const doc = await docIn(await call(owner, `/api/repos/${owner}/${repo}/do/file${fileQ(file)}`));
    const cut = doc && trimDiff(file, doc.lines.map((l) => l.text).join("\n"));
    if (!cut) continue;
    const open = await env.DB.prepare("SELECT diff FROM dexter_trims WHERE owner = ? AND repo = ? AND file = ? AND status = 'open'").bind(owner, repo, file).first<{ diff: string }>();
    if (open?.diff === cut.diff) continue;
    await env.DB.batch([
      env.DB.prepare("UPDATE dexter_trims SET status = 'declined', decided_by = ?, decided_at = ? WHERE owner = ? AND repo = ? AND file = ? AND status = 'open'").bind(AGENT, now, owner, repo, file),
      env.DB.prepare("INSERT INTO dexter_trims (owner, repo, file, diff, saved, status, at) VALUES (?, ?, ?, ?, ?, 'open', ?)").bind(owner, repo, file, cut.diff, cut.saved, now),
    ]);
  }
}

/** The lines `diff` (trimDiff's one-line hunks) makes of `lines`, or null when a line it cuts has changed since. */
export function applyTrim(lines: string[], diff: string): string[] | null {
  const out = [...lines];
  for (const h of diff.matchAll(/^@@ -(\d+) \+\d+ @@\n-(.*)\n\+(.*)$/gm)) {
    const at = Number(h[1]) - 1;
    if (out[at] !== h[2]) return null;
    out[at] = h[3]!;
  }
  return out;
}

/** Approved: agent-dexter opens dexter-trims-<id> with the cut, for a person to merge. Declined: it's only marked. */
async function decide(env: Env, call: Call, owner: string, repo: string, t: Trim, user: string, approve: boolean, now: number): Promise<Response | null> {
  if (!approve) {
    await env.DB.prepare("UPDATE dexter_trims SET status = 'declined', decided_by = ?, decided_at = ? WHERE id = ?").bind(user, now, t.id).run();
    return null;
  }
  const base = `/api/repos/${owner}/${repo}`, branch = `dexter-trims-${t.id}`;
  const added = await call(owner, `${base}/collaborators`, { method: "POST", body: JSON.stringify({ name: AGENT }) });
  if (!added.ok && added.status !== 409) throw new Error(`adding ${AGENT}: ${added.status}`);
  const made = await call(AGENT, `${base}/branches`, { method: "POST", body: JSON.stringify({ name: branch }) });
  if (!made.ok && made.status !== 409) throw new Error(`opening ${branch}: ${made.status} ${await made.text()}`);
  const doc = await docIn(await call(AGENT, `${base}/do/file${fileQ(t.file, branch)}`));
  const next = doc && applyTrim(doc.lines.map((l) => l.text), t.diff);
  if (!doc || !next) return fail("TrimStale", `${t.file} changed since Dexter proposed this: ask him again`);
  const ops = diffToOps(doc.lines, next);
  const posted = ops.length && await call(AGENT, `${base}/do/ops${fileQ(t.file, branch)}`, { method: "POST", body: JSON.stringify({ ops }) });
  if (posted && !posted.ok) throw new Error(`editing ${t.file} on ${branch}: ${posted.status}`);
  await env.DB.prepare("UPDATE dexter_trims SET status = 'approved', decided_by = ?, decided_at = ?, branch = ? WHERE id = ?").bind(user, now, branch, t.id).run();
  return null;
}

export async function dexterRoutes(req: Request, env: Env, call: Call, p: string[], owner: string, repo: string, user: string | null, write: boolean): Promise<Response | null> {
  const now = Date.now();
  if (!p[5]) {
    if (req.method === "GET") return json(await dexterState(env, owner, repo, now));
    if (req.method !== "PUT") return null;
    if (user !== owner) return fail("OwnerOnly", "only the repo's owner switches Dexter on or off");
    const b = need(await readBody(req), ON, "on: true switches Dexter on, false switches him off and deletes what he kept");
    if (b instanceof Response) return b;
    await setDexter(env, owner, repo, b.on, now);
    return json(await dexterState(env, owner, repo, now));
  }
  if (p[5] !== "trims" || req.method !== "POST" || p[7]) return null;
  if (!write || !user) return fail("NoWriteAccess", "no write access");
  if (!(await dexterOn(env, owner, repo))) return fail("DexterOff", "Dexter is off for this repo: its owner switches him on first");
  if (!p[6]) {
    await propose(env, call, owner, repo, now);
    return json(await dexterState(env, owner, repo, now), 201);
  }
  const b = need(await readBody(req), DECIDE, "approve: true puts the cut on a branch for you to merge, false declines it");
  if (b instanceof Response) return b;
  const t = await env.DB.prepare("SELECT id, file, diff, saved, status, at, decided_by, decided_at, branch FROM dexter_trims WHERE owner = ? AND repo = ? AND id = ?").bind(owner, repo, Number(p[6]) || 0).first<Trim>();
  if (!t || t.status !== "open") return fail("NoSuchTrim", "no open trim by that id: it was decided, or never was");
  return (await decide(env, call, owner, repo, t, user, b.approve, now)) ?? json(await dexterState(env, owner, repo, now));
}
