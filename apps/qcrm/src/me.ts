// The signed-in person's own things.
//
//   GET    /api/me                          {user, orgs: [{id, name, role}], superAdmin}
//   DELETE /api/me?confirm=<email>          the account, the orgs it owns and every row of them
//   GET    /api/orgs/:org/export            every row of the org as one JSON (owner+)
//   GET    /api/orgs/:org/audit?limit=      who did what to the org (manager+)

import type { User } from "./auth.ts";
import { error, json, parseJson, type Env } from "./env.ts";
import { deleteOrg, ensureOwnOrg, listOrgs, orgRow, superAdmin, type Ctx } from "./orgs.ts";

export async function meRoutes(req: Request, env: Env, url: URL, user: User): Promise<Response | null> {
  if (req.method === "GET") {
    await ensureOwnOrg(env, user);
    return json({ user: { id: user.id, email: user.email, name: user.name, ...(user.key ? { via: "key" } : {}) }, orgs: await listOrgs(env, user), superAdmin: superAdmin(env, user) });
  }
  if (req.method !== "DELETE") return null;
  if (user.key) return error(403, "an API key can't delete the account: sign in on the site");
  if (url.searchParams.get("confirm")?.trim().toLowerCase() !== user.email.toLowerCase()) return error(400, "confirm: your email, to be sure");
  const { results } = await env.DB.prepare("SELECT id FROM orgs WHERE owner_user_id = ?").bind(user.id).all<{ id: string }>();
  for (const o of results) await deleteOrg(env, o.id);
  // Sessions and accounts cascade from the user row.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM memberships WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM oauth_grants WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM oauth_requests WHERE user_id = ?").bind(user.id),
    env.DB.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(user.id),
    env.DB.prepare('DELETE FROM "account" WHERE "userId" = ?').bind(user.id),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(user.id),
  ]);
  return json({ ok: true, orgs_deleted: results.length }, 200, { "set-cookie": "better-auth.session_token=; Path=/; Max-Age=0; SameSite=Lax" });
}

const EXPORTED = ["contacts", "companies", "deals", "activities", "memberships", "webhooks", "audit"] as const;

export async function exportRoutes({ req, env, org, p, audit }: Ctx): Promise<Response | null> {
  if (p[1] || req.method !== "GET") return null;
  if (p[0] === "export") {
    const tables = await env.DB.batch(EXPORTED.map((t) => env.DB.prepare(`SELECT * FROM ${t} WHERE org_id = ?`).bind(org)));
    const out: Record<string, unknown> = { org: await orgRow(env, org), exported_at: Date.now() };
    EXPORTED.forEach((t, i) => { out[t] = tables[i]!.results; });
    await audit("export", null, Object.fromEntries(EXPORTED.map((t, i) => [t, tables[i]!.results.length])));
    return json(out, 200, { "content-disposition": `attachment; filename="qcrm-${org}.json"` });
  }
  if (p[0] === "audit") {
    const limit = Math.min(500, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 100));
    const { results } = await env.DB.prepare("SELECT id, actor_user_id, action, target, at, detail FROM audit WHERE org_id = ? ORDER BY at DESC LIMIT ?").bind(org, limit).all();
    return json(results.map((r) => ({ ...r, detail: parseJson(r.detail, null) })));
  }
  return null;
}
