// POST /api/demo: a throwaway account signed in on the spot, owning "Demo Co" with 10,000
// contacts. The rows are the shared snapshot in R2 (demo-snapshot.ts), not copies: making a demo
// writes the account and the org, and a visitor's edits write only the rows they touch.
// The response carries the session cookie, so a visitor is in the app one click later.
// Demo orgs are plan 'demo' (scenario orgs, scenario.ts, are plan 'scenario'); the hourly cron
// (`hourly`, called from worker.tsx) deletes both, and their accounts, a day after they were made.

import { authFor, type User } from "./auth.ts";
import { demoView, TABLES, warmDemo } from "./demo-snapshot.ts";
import { b64url, error, json, type Env } from "./env.ts";
import { createOrg, deleteOrg } from "./orgs.ts";
import { sweepOAuth } from "./oauth.ts";

const DEMO_TTL = 24 * 3600_000;

/** A throwaway account, signed in: the user and the headers that carry its session cookie. */
export async function throwaway(req: Request, env: Env, name: string, prefix = "demo") {
  const id = b64url(crypto.getRandomValues(new Uint8Array(9))).toLowerCase().replace(/[^a-z0-9]/g, "x");
  const email = `${prefix}-${id}@qcrm.local`;
  const password = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const { headers, response } = await authFor(req, env).api.signUpEmail({ body: { email, password, name }, returnHeaders: true });
  if (!response?.user) return null;
  return { user: { id: response.user.id, email, name } satisfies User, headers };
}

export async function demoRoute(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return error(405, "POST to make a demo account");
  const view = await demoView(env);
  const made = await throwaway(req, env, "Demo");
  if (!made) return error(500, "could not make the demo account");
  const { user, headers } = made;
  const org = await createOrg(env, user, "Demo Co", "demo");
  const seeded = Object.fromEntries(TABLES.map((t) => [t, view.rows[t].length]));
  const res = json({ org: { ...org, role: "admin", seeded }, user }, 201);
  for (const c of headers.getSetCookie()) res.headers.append("set-cookie", c);
  return res;
}

/** Demo and scenario orgs older than a day go, with their accounts. Called once an hour by worker.tsx. */
export async function hourly(env: Env): Promise<void> {
  // Builds and stores the snapshot when the bucket has none, so the first visitor doesn't wait on it.
  await warmDemo(env).catch(() => {});
  const { results } = await env.DB.prepare("SELECT id, owner_user_id FROM orgs WHERE plan IN ('demo', 'scenario') AND created_at < ?").bind(Date.now() - DEMO_TTL).all<{ id: string; owner_user_id: string }>();
  for (const o of results) {
    // Scenario orgs (scenario.ts) have throwaway members too.
    const members = await env.DB.prepare('SELECT u.id FROM memberships m JOIN "user" u ON u.id = m.user_id WHERE m.org_id = ? AND u.email LIKE ?').bind(o.id, "scenario-%@qcrm.local").all<{ id: string }>();
    await deleteOrg(env, o.id);
    for (const m of members.results) await env.DB.batch([
      env.DB.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(m.id), env.DB.prepare('DELETE FROM "account" WHERE "userId" = ?').bind(m.id), env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(m.id),
    ]);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM memberships WHERE user_id = ?").bind(o.owner_user_id),
      env.DB.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(o.owner_user_id),
      env.DB.prepare('DELETE FROM "account" WHERE "userId" = ?').bind(o.owner_user_id),
      env.DB.prepare('DELETE FROM "user" WHERE id = ? AND email LIKE ?').bind(o.owner_user_id, "demo-%@qcrm.local"),
    ]);
  }
  await sweepOAuth(env);
  // A retry whose queue message was lost (the delay window passed by more than an hour) gets a fresh one.
  const stale = await env.DB.prepare("SELECT id, attempts FROM webhook_deliveries WHERE status = 'pending' AND next_at < ? LIMIT 100").bind(Date.now() - 3600_000).all<{ id: string; attempts: number }>();
  for (const d of stale.results) await env.HOOKS?.send({ delivery: d.id, attempt: d.attempts + 1 });
}
