// The signed-in person's own things.
//
//   GET    /api/me                          {user, orgs: [{id, name, role}], superAdmin}
//   DELETE /api/me?confirm=<email>          the account, the orgs it owns and every row of them
//   GET    /api/orgs/:org/export[?deleted=1]  every row of the org as one JSON (owner+); soft-deleted rows only with deleted=1
//   GET    /api/orgs/:org/audit?actor=&action=&since=&cursor=&limit=   who did what to the org, newest first (manager+): {items, next}

import type { User } from "./auth.ts";
import { b64url, error, json, parseJson, type Env } from "./env.ts";
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
  return json({ ok: true, orgs_deleted: results.length }, 200, { "set-cookie": "qcrm.session_token=; Path=/; Max-Age=0; SameSite=Lax" });
}

/** The soft-deleted entities: their deleted_at rows stay out of a download unless asked for. */
const SOFT = new Set(["contacts", "companies", "deals", "activities"]);
const EXPORTED = ["contacts", "companies", "deals", "activities", "memberships", "webhooks", "audit"] as const;

export async function exportRoutes({ req, env, org, p, audit }: Ctx): Promise<Response | null> {
  if (p[1] || req.method !== "GET") return null;
  if (p[0] === "export") {
    const deleted = new URL(req.url).searchParams.get("deleted") === "1";
    const tables = await env.DB.batch(EXPORTED.map((t) => env.DB.prepare(`SELECT * FROM ${t} WHERE org_id = ?${SOFT.has(t) && !deleted ? " AND deleted_at IS NULL" : ""}`).bind(org)));
    const out: Record<string, unknown> = { org: await orgRow(env, org), exported_at: Date.now(), includes_deleted: deleted };
    EXPORTED.forEach((t, i) => { out[t] = tables[i]!.results; });
    await audit("export", null, Object.fromEntries(EXPORTED.map((t, i) => [t, tables[i]!.results.length])));
    return json(out, 200, { "content-disposition": `attachment; filename="qcrm-${org}${deleted ? "-with-deleted" : ""}.json"` });
  }
  if (p[0] === "audit") {
    const q = new URL(req.url).searchParams;
    const limit = Math.min(500, Math.max(1, Number(q.get("limit")) || 100));
    const where = ["a.org_id = ?"], args: unknown[] = [org];
    const actor = q.get("actor"), action = q.get("action"), since = q.get("since");
    if (actor) { where.push("(a.actor_user_id = ? OR lower(au.email) = lower(?))"); args.push(actor, actor); }
    if (action) { where.push("(a.action = ? OR a.action LIKE ?)"); args.push(action, `${action}.%`); }
    if (since) {
      const t = /^\d+$/.test(since) ? Number(since) : Date.parse(since);
      if (!Number.isFinite(t)) return error(400, "since is a millisecond timestamp or a date");
      where.push("a.at >= ?"); args.push(t);
    }
    const cur = q.get("cursor");
    if (cur) {
      let at: unknown, id: unknown;
      try { [at, id] = JSON.parse(atob(cur.replace(/-/g, "+").replace(/_/g, "/"))); } catch { /* falls through to the check */ }
      if (!Number.isInteger(at) || typeof id !== "string") return error(400, "cursor is the next value of the page before");
      where.push("(a.at < ? OR (a.at = ? AND a.id < ?))"); args.push(at, at, id);
    }
    const { results } = await env.DB.prepare(`SELECT a.id, a.actor_user_id, au.name AS actor_name, au.email AS actor_email, a.action, a.target,
      CASE substr(a.action, 1, instr(a.action, '.') - 1)
        WHEN 'member' THEN (SELECT coalesce(u.name, u.email) FROM "user" u WHERE u.id = a.target)
        WHEN 'key' THEN (SELECT k.name FROM api_keys k WHERE k.id = a.target)
        WHEN 'webhook' THEN (SELECT w.url FROM webhooks w WHERE w.id = a.target) END AS target_name,
      substr(a.action, 1, instr(a.action || '.', '.') - 1) AS target_type, a.at, a.detail
      FROM audit a LEFT JOIN "user" au ON au.id = a.actor_user_id WHERE ${where.join(" AND ")} ORDER BY a.at DESC, a.id DESC LIMIT ?`).bind(...args, limit + 1).all();
    const page = results.slice(0, limit), last = page[limit - 1];
    const next = results.length > limit && last ? b64url(new TextEncoder().encode(JSON.stringify([last.at, last.id]))) : null;
    return json({ items: page.map((r) => ({ ...r, detail: parseJson(r.detail, null) })), next });
  }
  return null;
}
