// GET /api/orgs/:org/insights: the numbers a dashboard opens with, each one SQL aggregate.
// Anything heavier (cohorts, forecasts) runs in the browser on the org's rows (the wasm engine).

import { demoRows, isDemo, TABLES, type Table } from "./demo-snapshot.ts";
import { json, type D1Result, type Env, type Row } from "./env.ts";
import type { Ctx } from "./orgs.ts";

const DAY = 86_400_000;

export async function insights(env: Env, org: string) {
  const now = Date.now(), since90 = now - 90 * DAY, since12w = now - 12 * 7 * DAY;
  if (await isDemo(env, org)) {
    const all = Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await demoRows(env, org, t)] as const))) as Record<Table, Row[]>;
    return demoInsights(all, now);
  }
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

/** The same numbers over a demo org's rows in memory (the snapshot with the visitor's edits on top), not SQL. */
function demoInsights(all: Record<Table, Row[]>, now: number) {
  const since90 = now - 90 * DAY, since12w = now - 12 * 7 * DAY;
  const stages = new Map<string, { stage: string; n: number; amount_cents: number }>();
  let won = 0, lost = 0;
  for (const d of all.deals) {
    const s = String(d.stage), e = stages.get(s) ?? stages.set(s, { stage: s, n: 0, amount_cents: 0 }).get(s)!;
    e.n++; e.amount_cents += Number(d.amount_cents) || 0;
    if (Number(d.close_at) >= since90) { if (s === "won") won++; else if (s === "lost") lost++; }
  }
  const perWeek = Array.from({ length: 12 }, (_, i) => ({ weeks_ago: i, total: 0 } as Record<string, number>));
  for (const a of all.activities) {
    const at = Number(a.at);
    if (!(at >= since12w && at <= now)) continue;
    const w = perWeek[Math.floor((now - at) / (7 * DAY))];
    if (w) { w[String(a.type)] = (w[String(a.type)] ?? 0) + 1; w.total! += 1; }
  }
  const companies = new Map(all.companies.map((c) => [c.id, c]));
  const open = new Map<unknown, { id: unknown; name: unknown; deals: number; amount_cents: number }>();
  for (const d of all.deals) {
    const c = companies.get(d.company_id);
    if (!c || d.stage === "won" || d.stage === "lost") continue;
    const e = open.get(c.id) ?? open.set(c.id, { id: c.id, name: c.name, deals: 0, amount_cents: 0 }).get(c.id)!;
    e.deals++; e.amount_cents += Number(d.amount_cents) || 0;
  }
  return {
    counts: { contacts: all.contacts.length, companies: all.companies.length, deals: all.deals.length, activities: all.activities.length },
    deals_by_stage: [...stages.values()].sort((a, b) => (a.stage < b.stage ? -1 : 1)),
    last_90_days: { won, lost, win_rate: won + lost ? won / (won + lost) : null },
    activities_per_week: perWeek,
    top_companies_by_open_pipeline: [...open.values()].sort((a, b) => b.amount_cents - a.amount_cents).slice(0, 10),
  };
}

export async function insightRoutes({ req, env, org, p }: Ctx): Promise<Response | null> {
  if (p[0] !== "insights" || p[1] || req.method !== "GET") return null;
  return json(await insights(env, org));
}
