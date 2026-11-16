// Agents as social actors. A coding agent edits as `agent-<harness>` (agent-claude,
// agent-deps), so it has a handle like a person's; this gives it a face. Its
// profile (GET /api/users/agent-…) says who runs it, on which harness, the repos
// it works in, its line edits and runs over time, and its runs themselves. All of
// it from repos the viewer may read; a run's task stays its owner's, as in
// agent-routes.ts.

import { parseJson } from "./util.ts";
import { HARNESSES } from "./harness.ts";
import type { Env } from "./env.ts";
import { live } from "./repos.ts";

/** How many of its runs, and days of its pulse, a profile shows. */
const RUNS = 30, DAYS = 30, DAY = 86_400_000;

/** Repos `viewer` may read, as SQL on alias `r`: bind (now, viewer, viewer). */
const SEEN = `${live("r")} AND (r.visibility = 'public' OR r.owner = ? OR EXISTS (SELECT 1 FROM collaborators c WHERE c.owner = r.owner AND c.repo = r.name AND c.name = ?))`;

/** What drives `agent`: a CLI harness, or one of codeSplitter' own (agent-deps is the dependency doctor). */
export function harnessOf(agent: string) {
  const h = agent.replace(/^agent-/, "");
  return (HARNESSES as string[]).includes(h) ? h : h === "deps" ? "dependency doctor" : h === "rustybuns" ? "Rusty Buns init" : h;
}

interface RunRow { id: number; owner: string; repo: string; path: string; harness: string; task: string; status: string; started: number; result: string | null }

export async function agentProfile(env: Env, agent: string, viewer: string | null) {
  const now = Date.now();
  const { results: repos } = await env.DB.prepare(
    `SELECT r.owner, r.name, r.visibility, r.level, r.created_at, r.expires_at FROM collaborators k JOIN repos r ON r.owner = k.owner AND r.name = k.repo WHERE k.name = ? AND ${SEEN} ORDER BY r.created_at DESC`)
    .bind(agent, now, viewer, viewer).all<{ owner: string }>();
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.owner, a.repo, a.path, a.harness, a.task, a.status, a.started, a.result FROM agent_runs a JOIN repos r ON r.owner = a.owner AND r.name = a.repo WHERE a.agent = ? AND ${SEEN} ORDER BY a.started DESC, a.id DESC`)
    .bind(agent, now, viewer, viewer).all<RunRow>();
  const rows = results;
  const runs = rows.map((r) => {
    const res = parseJson<{ applied?: number }>(r.result, {});
    return { id: r.id, owner: r.owner, repo: r.repo, path: r.path, status: r.status, started: r.started, applied: res.applied ?? 0,
      // Who gave it the task sees the task.
      ...(viewer === r.owner && { task: r.task }) };
  });
  // Its pulse: runs and line edits per UTC day, oldest first, the last DAYS of them. Line edits are every one it made
  // (line_events, kept as long as the pulse looks back), a site-started run's or not: an invited agent edits over the API.
  const today = Math.floor(now / DAY) * DAY, since = today - (DAYS - 1) * DAY;
  const pulse = Array.from({ length: DAYS }, (_, i) => ({ day: today - (DAYS - 1 - i) * DAY, runs: 0, lines: 0 }));
  const dayOf = (t: number) => pulse[DAYS - 1 - Math.floor((today - Math.floor(t / DAY) * DAY) / DAY)];
  for (const r of runs) { const d = dayOf(r.started); if (d) d.runs++; }
  const { results: edits } = await env.DB.prepare(
    `SELECT e.last_at, e.sets + e.inserts AS n FROM line_events e JOIN repos r ON r.owner = e.owner AND r.name = e.repo WHERE e.who = ? AND e.last_at >= ? AND ${SEEN}`)
    .bind(agent, since, now, viewer, viewer).all<{ last_at: number; n: number }>();
  for (const e of edits) { const d = dayOf(e.last_at); if (d) d.lines += e.n; }
  // Before the pulse's window only its runs' tallies are left.
  const older = runs.reduce((n, r) => n + (r.started < since ? r.applied : 0), 0);
  // Who runs it: the owners whose repos it works in, busiest first.
  const by = new Map<string, number>();
  for (const r of repos) by.set(r.owner, by.get(r.owner) ?? 0);
  for (const r of runs) by.set(r.owner, (by.get(r.owner) ?? 0) + 1);
  return {
    harness: rows[0]?.harness ?? harnessOf(agent),
    run_by: [...by].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, runs: n })),
    repos,
    lines: older + pulse.reduce((n, d) => n + d.lines, 0),
    pulse,
    runs: runs.slice(0, RUNS),
    run_count: runs.length,
  };
}
