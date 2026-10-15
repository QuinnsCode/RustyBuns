// Agents as social actors. A coding agent edits as `agent-<harness>` (agent-claude,
// agent-deps), so it has a handle like a person's; this gives it a face. Its
// profile (GET /api/users/agent-…) says who runs it, on which harness, the repos
// it works in, its line edits and runs over time, and its runs themselves. All of
// it from repos the viewer may read; a run's task stays its owner's, as in
// agent-routes.ts.

import { HARNESSES } from "./harness.ts";
import type { Env } from "./env.ts";

/** How many of its runs, and days of its pulse, a profile shows. */
const RUNS = 30, DAYS = 30, DAY = 86_400_000;

/** Repos `viewer` may read, as SQL on alias `r`: bind (now, viewer, viewer). */
const SEEN = "(r.expires_at IS NULL OR r.expires_at > ?) AND (r.visibility = 'public' OR r.owner = ? OR EXISTS (SELECT 1 FROM collaborators c WHERE c.owner = r.owner AND c.repo = r.name AND c.name = ?))";

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
    .bind(agent, now, viewer, viewer).all();
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.owner, a.repo, a.path, a.harness, a.task, a.status, a.started, a.result FROM agent_runs a JOIN repos r ON r.owner = a.owner AND r.name = a.repo WHERE a.agent = ? AND ${SEEN} ORDER BY a.started DESC, a.id DESC`)
    .bind(agent, now, viewer, viewer).all();
  const rows = results as RunRow[];
  const runs = rows.map((r) => {
    const res = r.result ? JSON.parse(r.result) as { applied?: number } : {};
    return { id: r.id, owner: r.owner, repo: r.repo, path: r.path, status: r.status, started: r.started, applied: res.applied ?? 0,
      // Who gave it the task sees the task.
      ...(viewer === r.owner && { task: r.task }) };
  });
  // Its pulse: runs and line edits per UTC day, oldest first, the last DAYS of them.
  const today = Math.floor(now / DAY) * DAY;
  const pulse = Array.from({ length: DAYS }, (_, i) => ({ day: today - (DAYS - 1 - i) * DAY, runs: 0, lines: 0 }));
  for (const r of runs) {
    const d = pulse[DAYS - 1 - Math.floor((today - Math.floor(r.started / DAY) * DAY) / DAY)];
    if (d) { d.runs++; d.lines += r.applied; }
  }
  // Who runs it: the owners whose repos it works in, busiest first.
  const by = new Map<string, number>();
  for (const r of repos as { owner: string }[]) by.set(r.owner, by.get(r.owner) ?? 0);
  for (const r of runs) by.set(r.owner, (by.get(r.owner) ?? 0) + 1);
  return {
    harness: rows[0]?.harness ?? harnessOf(agent),
    run_by: [...by].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, runs: n })),
    repos,
    lines: runs.reduce((n, r) => n + r.applied, 0),
    pulse,
    runs: runs.slice(0, RUNS),
    run_count: runs.length,
  };
}
