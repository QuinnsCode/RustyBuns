// GET /api/orgs/:org/insights: the numbers a dashboard opens with, each one SQL aggregate.
// Anything heavier (cohorts, forecasts) runs in the browser on the org's rows (the wasm engine).

import { json, type D1Result, type Env } from "./env.ts";
import type { Ctx } from "./orgs.ts";

const DAY = 86_400_000;

export async function insights(env: Env, org: string) {
  const now = Date.now(), since90 = now - 90 * DAY, since12w = now - 12 * 7 * DAY;
  const [counts, stages, outcome, weeks, top] = (await env.DB.batch([
    env.DB.prepare(`SELECT (SELECT COUNT(*) FROM contacts WHERE org_id = ?1 AND deleted_at IS NULL) AS contacts, (SELECT COUNT(*) FROM companies WHERE org_id = ?1 AND deleted_at IS NULL) AS companies,
      (SELECT COUNT(*) FROM deals WHERE org_id = ?1 AND deleted_at IS NULL) AS deals, (SELECT COUNT(*) FROM activities WHERE org_id = ?1 AND deleted_at IS NULL) AS activities`).bind(org),
    env.DB.prepare("SELECT stage, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS amount_cents FROM deals WHERE org_id = ? AND deleted_at IS NULL GROUP BY stage").bind(org),
    env.DB.prepare("SELECT stage, COUNT(*) AS n FROM deals WHERE org_id = ? AND deleted_at IS NULL AND stage IN ('won', 'lost') AND close_at >= ? GROUP BY stage").bind(org, since90),
    // Weeks counted back from now, so the newest bucket is the current (partial) week.
    env.DB.prepare("SELECT CAST((? - at) / ? AS INTEGER) AS weeks_ago, type, COUNT(*) AS n FROM activities WHERE org_id = ? AND deleted_at IS NULL AND at >= ? AND at <= ? GROUP BY weeks_ago, type").bind(now, 7 * DAY, org, since12w, now),
    env.DB.prepare(`SELECT c.id, c.name, COUNT(d.id) AS deals, SUM(d.amount_cents) AS amount_cents FROM deals d JOIN companies c ON c.id = d.company_id AND c.org_id = d.org_id
      WHERE d.org_id = ? AND d.deleted_at IS NULL AND c.deleted_at IS NULL AND d.stage NOT IN ('won', 'lost') GROUP BY c.id ORDER BY amount_cents DESC LIMIT 10`).bind(org),
  ])) as [D1Result, D1Result, D1Result, D1Result, D1Result];
  const won = Number(outcome.results.find((r) => r.stage === "won")?.n ?? 0), lost = Number(outcome.results.find((r) => r.stage === "lost")?.n ?? 0);
  const perWeek = Array.from({ length: 12 }, (_, i) => ({ weeks_ago: i, total: 0 } as Record<string, number>));
  for (const r of weeks.results) { const w = perWeek[Number(r.weeks_ago)]; if (w) { w[String(r.type)] = Number(r.n); w.total! += Number(r.n); } }
  return {
    counts: counts.results[0],
    deals_by_stage: stages.results,
    last_90_days: { won, lost, win_rate: won + lost ? won / (won + lost) : null },
    activities_per_week: perWeek,
    top_companies_by_open_pipeline: top.results,
  };
}

export async function insightRoutes({ req, env, org, p }: Ctx): Promise<Response | null> {
  if (p[0] !== "insights" || p[1] || req.method !== "GET") return null;
  return json(await insights(env, org));
}
