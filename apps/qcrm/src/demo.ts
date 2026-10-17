// POST /api/demo: a throwaway account signed in on the spot, owning "Demo Co" with 2,000 seeded
// contacts. The response carries the session cookie, so a visitor is in the app one click later.
// Demo orgs are plan 'demo'; the hourly cron (`hourly`, called from worker.tsx) deletes them,
// and their accounts, a day after they were made.

import type { Defer } from "./api.ts";
import { authFor, type User } from "./auth.ts";
import { b64url, error, json, type Env } from "./env.ts";
import { createOrg, deleteOrg } from "./orgs.ts";
import { sweepOAuth } from "./oauth.ts";
import { seedOrg } from "./seed-data.ts";

const DEMO_CONTACTS = 2000;
const FIRST_PAGE = 200; // seeded before the response, so the frame has rows at once; the rest follows it
const DEMO_TTL = 24 * 3600_000;

export async function demoRoute(req: Request, env: Env, defer?: Defer): Promise<Response> {
  if (req.method !== "POST") return error(405, "POST to make a demo account");
  const id = b64url(crypto.getRandomValues(new Uint8Array(9))).toLowerCase().replace(/[^a-z0-9]/g, "x");
  const email = `demo-${id}@qcrm.local`;
  const password = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const { headers, response } = await authFor(req, env).api.signUpEmail({ body: { email, password, name: "Demo" }, returnHeaders: true });
  if (!response?.user) return error(500, "could not make the demo account");
  const user: User = { id: response.user.id, email, name: "Demo" };
  const org = await createOrg(env, user, "Demo Co", "demo");
  const seed = Date.now() % 100_000;
  const seeded = await seedOrg(env, org.id, user.id, FIRST_PAGE, seed);
  const rest = seedOrg(env, org.id, user.id, DEMO_CONTACTS - FIRST_PAGE, seed + 1);
  if (defer) defer(rest.catch(() => {})); else await rest;
  const res = json({ org: { ...org, role: "admin", seeded }, user: { id: user.id, email, name: user.name } }, 201);
  for (const c of headers.getSetCookie()) res.headers.append("set-cookie", c);
  return res;
}

/** Demo orgs older than a day go, with their accounts. Called once an hour by worker.tsx. */
export async function hourly(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id, owner_user_id FROM orgs WHERE plan = 'demo' AND created_at < ?").bind(Date.now() - DEMO_TTL).all<{ id: string; owner_user_id: string }>();
  for (const o of results) {
    await deleteOrg(env, o.id);
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
