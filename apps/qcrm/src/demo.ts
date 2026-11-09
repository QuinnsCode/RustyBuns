// POST /api/demo: a throwaway account signed in on the spot, owning "Demo Co" with 10,000
// contacts. The rows are the shared snapshot in R2 (demo-snapshot.ts), not copies: making a demo
// writes the account and the org, and a visitor's edits write only the rows they touch.
// The response carries the session cookie, so a visitor is in the app one click later.
// A demo lasts an hour: after that its account gets 410 before any route runs, and the hourly cron
// (`hourly`, called from worker.tsx) deletes it. Each visitor (a salted hash of the IP) gets
// DEMO_PER_DAY demos a day, then 429 and the page's sign-up card. Scenario orgs (scenario.ts,
// plan 'scenario') go a day after they were made.

import { authFor, type User } from "./auth.ts";
import { demoView, TABLES, warmDemo } from "./demo-snapshot.ts";
import { b64url, error, json, sha256, type Env } from "./env.ts";
import { createOrg, deleteOrg } from "./orgs.ts";
import { sweepOAuth } from "./oauth.ts";
import { runScheduled } from "./scripts.ts";

export const DEMO_TTL = 3600_000;
export const DEMO_PER_DAY = 3;
const DAY = 24 * 3600_000;

/** Whose visit this is: a salted hash of the IP, or null where there is none (the desktop, the tests). */
const visitor = (req: Request, env: Env) => {
  const ip = req.headers.get("cf-connecting-ip");
  return ip ? sha256(`demo:${ip}:${env.BETTER_AUTH_SECRET ?? ""}`) : null;
};

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
  const who = await visitor(req, env), now = Date.now();
  if (who) {
    const used = await env.DB.prepare("SELECT count(*) AS n FROM demo_visits WHERE ip_hash = ? AND at > ?").bind(who, now - DAY).first<number>("n");
    if ((used ?? 0) >= DEMO_PER_DAY) return json({ error: `That's your ${DEMO_PER_DAY} demo hours for today. Make an account to keep going.`, quota: DEMO_PER_DAY }, 429, { "retry-after": "3600" });
  }
  const view = await demoView(env);
  const made = await throwaway(req, env, "Demo");
  if (!made) return error(500, "could not make the demo account");
  const { user, headers } = made;
  const org = await createOrg(env, user, "Demo Co", "demo");
  if (who) await env.DB.prepare("INSERT INTO demo_visits (ip_hash, at) VALUES (?, ?)").bind(who, now).run();
  const seeded = Object.fromEntries(TABLES.map((t) => [t, view.rows[t].length]));
  const res = json({ org: { ...org, role: "admin", seeded, ends_at: org.created_at + DEMO_TTL }, user }, 201);
  for (const c of headers.getSetCookie()) res.headers.append("set-cookie", c);
  return res;
}

/** A demo account past its hour gets 410 before any route runs. Every other account passes on a string test. */
export async function demoOver(env: Env, user: User): Promise<Response | null> {
  if (!/^demo-[a-z0-9]+@qcrm\.local$/.test(user.email)) return null;
  const made = await env.DB.prepare("SELECT created_at FROM orgs WHERE owner_user_id = ? AND plan = 'demo'").bind(user.id).first<number>("created_at");
  // No demo org: a scenario's owner (the same email shape) or one the sweep already took, which 401s anyway.
  if (made == null || made + DEMO_TTL > Date.now()) return null;
  return json({ error: "Your demo hour is up. Make an account to keep going.", ended: true }, 410);
}

/** Demos past their hour and scenario orgs a day old go, with their accounts; visits a day old are forgotten; scheduled scripts run. Called once an hour by worker.tsx. */
export async function hourly(env: Env): Promise<void> {
  // Builds and stores the snapshot when the bucket has none, so the first visitor doesn't wait on it.
  await warmDemo(env).catch(() => {});
  const { results } = await env.DB.prepare("SELECT id, owner_user_id FROM orgs WHERE (plan = 'demo' AND created_at < ?) OR (plan = 'scenario' AND created_at < ?)").bind(Date.now() - DEMO_TTL, Date.now() - DAY).all<{ id: string; owner_user_id: string }>();
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
  await env.DB.prepare("DELETE FROM demo_visits WHERE at < ?").bind(Date.now() - DAY).run();
  await sweepOAuth(env);
  // Scripts on a schedule (scripts.ts): hourly is the only one, so each runs once here.
  await runScheduled(env).catch(() => {});
  // A retry whose queue message was lost (the delay window passed by more than an hour) gets a fresh one.
  const stale = await env.DB.prepare("SELECT id, attempts FROM webhook_deliveries WHERE status = 'pending' AND next_at < ? LIMIT 100").bind(Date.now() - 3600_000).all<{ id: string; attempts: number }>();
  for (const d of stale.results) await env.HOOKS?.send({ delivery: d.id, attempt: d.attempts + 1 });
}
