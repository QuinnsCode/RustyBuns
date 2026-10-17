// How much scripting an org gets. Policies stack: every one that applies to a run is checked before
// it starts, and the first that is full refuses it (429, retry-after). Each counts script_runs rows
// in a sliding window, so there is no counter to drift. A manual run over quota gets a 429 and no row;
// a scheduled run over quota is recorded as `skipped` (never counted), so the log says why it didn't go.
//
//   who             what                     per
//   employee        20 runs                  hour, each person
//   manager         60 runs                  hour, each person
//   owner and up    200 runs                 hour, each person
//   anyone          1,000 runs, 50,000 calls day, the whole org

import type { Env } from "./env.ts";
import { rank, type Role } from "./rbac.ts";

const HOUR = 3_600_000, DAY = 24 * HOUR;
export interface Policy { name: string; /** From this role up the policy applies, and the highest role that gets this cap. */ role?: Role; scope: "user" | "org"; per: "runs" | "calls"; max: number; window_ms: number }

/** Most specific per-person row wins; org rows all apply. */
export const POLICIES: Policy[] = [
  { name: "owner-hour", role: "owner", scope: "user", per: "runs", max: 200, window_ms: HOUR },
  { name: "manager-hour", role: "manager", scope: "user", per: "runs", max: 60, window_ms: HOUR },
  { name: "employee-hour", role: "employee", scope: "user", per: "runs", max: 20, window_ms: HOUR },
  { name: "org-runs-day", scope: "org", per: "runs", max: 1000, window_ms: DAY },
  { name: "org-calls-day", scope: "org", per: "calls", max: 50_000, window_ms: DAY },
];

/** The policies a run by `role` is held to: the highest per-person row at or below the role, plus every org row. */
export function policiesFor(role: Role, policies = POLICIES): Policy[] {
  const mine = policies.filter((p) => p.scope === "user" && rank(role) >= rank(p.role!)).sort((a, b) => rank(b.role!) - rank(a.role!))[0];
  return [...(mine ? [mine] : []), ...policies.filter((p) => p.scope === "org")];
}

/** The first full policy, with the ms until a slot frees; null when the run may go. Skipped rows don't count. */
export async function overQuota(env: Env, org: string, userId: string, role: Role, now = Date.now()): Promise<{ policy: Policy; retry_ms: number } | null> {
  for (const p of policiesFor(role)) {
    const since = now - p.window_ms;
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(calls), 0) AS calls, MIN(started_at) AS oldest FROM script_runs
      WHERE org_id = ? AND started_at > ? AND status != 'skipped'${p.scope === "user" ? " AND actor_user_id = ?" : ""}`)
      .bind(...[org, since, ...(p.scope === "user" ? [userId] : [])]).first<{ n: number; calls: number; oldest: number | null }>();
    const used = p.per === "runs" ? row?.n ?? 0 : row?.calls ?? 0;
    if (used >= p.max) return { policy: p, retry_ms: Math.max(1000, (row?.oldest ?? now) + p.window_ms - now) };
  }
  return null;
}

export const describe = (p: Policy) => `${p.max.toLocaleString("en-US")} script ${p.per} per ${p.window_ms === HOUR ? "hour" : "day"}${p.scope === "user" ? " per person" : " for the org"}`;
