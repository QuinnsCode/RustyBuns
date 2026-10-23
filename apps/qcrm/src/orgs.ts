// Orgs: who owns one, who is in it with what role, and the id URLs carry.
//
// An org's id is "org_" + a hash of the owner's account id salted with the auth secret, so it
// can be a public URL without naming anyone and nobody can derive it for someone else. A
// person's first org (made on first sight of their account) uses the plain hash; further orgs
// add a random salt, so each is still unwalkable.
//
//   GET    /api/orgs                          your orgs with your role in each
//   POST   /api/orgs {name}                   a new org you own
//   GET    /api/orgs/:org                     the org row and your role
//   DELETE /api/orgs/:org                     the org and every row of it (admin+)
//   GET    /api/orgs/:org/members
//   POST   /api/orgs/:org/members {email, role?}   add someone with an account; seasonal by default
//   PUT    /api/orgs/:org/members/:user {role}
//   DELETE /api/orgs/:org/members/:user
//
// Someone who is not a member gets 404 for everything under /api/orgs/:org, the same as for an
// org that does not exist, so an id never tells whether it is real.

import type { User } from "./auth.ts";
import { b64url, digest, error, json, readBody, type Env } from "./env.ts";
import { can, canSetRole, DEFAULT_ROLE, GRANTABLE, isRole, rank, type Role } from "./rbac.ts";
import { emit } from "./webhooks.ts";

/** What every org-scoped route gets: who is asking, which org, their role in it, the path after /api/orgs/:org/. */
export interface Ctx {
  req: Request; env: Env; url: URL; user: User; org: string; role: Role; p: string[];
  /** Log something done to the org itself. */
  audit(action: string, target?: string | null, detail?: unknown): Promise<void>;
}

export async function orgId(ownerUserId: string, secret: string, salt = "") {
  return "org_" + b64url(await digest(`${secret}:${ownerUserId}${salt}`)).slice(0, 20);
}

export const superAdmin = (env: Env, user: User) => !!env.SUPER_ADMIN_EMAIL && env.SUPER_ADMIN_EMAIL.trim().toLowerCase() === user.email.toLowerCase();

/** The role `userId` holds in `org`, or null. The super admin is never a member row. */
export async function memberOf(env: Env, org: string, userId: string): Promise<Role | null> {
  const r = await env.DB.prepare("SELECT role FROM memberships WHERE org_id = ? AND user_id = ?").bind(org, userId).first<{ role: string }>();
  return r && isRole(r.role) ? r.role : null;
}

/** The role this request acts with in `org`: super admin everywhere; an API key only in its own org. */
export async function roleIn(env: Env, org: string, user: User): Promise<Role | null> {
  if (user.key && user.key.org_id !== org) return null;
  if (superAdmin(env, user)) return "super_admin";
  return memberOf(env, org, user.id);
}

export const orgRow = (env: Env, org: string) =>
  env.DB.prepare("SELECT id, name, owner_user_id, created_at, plan FROM orgs WHERE id = ?").bind(org).first<{ id: string; name: string; owner_user_id: string; created_at: number; plan: string }>();

export async function createOrg(env: Env, owner: User, name: string, plan = "free", salt = "") {
  const id = await orgId(owner.id, env.BETTER_AUTH_SECRET!, salt);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO orgs (id, name, owner_user_id, created_at, plan) VALUES (?, ?, ?, ?, ?)").bind(id, name, owner.id, now, plan),
    env.DB.prepare("INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)").bind(id, owner.id, now),
  ]);
  return { id, name, owner_user_id: owner.id, created_at: now, plan };
}

/** A person's own org, made the first time they are seen. */
export async function ensureOwnOrg(env: Env, user: User) {
  const id = await orgId(user.id, env.BETTER_AUTH_SECRET!);
  return (await orgRow(env, id)) ?? createOrg(env, user, `${user.name || user.email.split("@")[0]}'s org`);
}

export async function listOrgs(env: Env, user: User) {
  const { results } = await env.DB.prepare("SELECT o.id, o.name, o.plan, m.role FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY o.created_at").bind(user.id).all();
  return results as { id: string; name: string; plan: string; role: Role }[];
}

export const ORG_TABLES = ["contacts", "companies", "deals", "activities", "changes", "webhooks", "webhook_deliveries", "api_keys", "audit", "memberships"] as const;

/** Every row of the org, then the org. */
export const deleteOrg = (env: Env, org: string) =>
  env.DB.batch([...ORG_TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE org_id = ?`).bind(org)), env.DB.prepare("DELETE FROM orgs WHERE id = ?").bind(org)]);

export const writeAudit = (env: Env, org: string, actor: string | null, action: string, target: string | null = null, detail: unknown = null) =>
  env.DB.prepare("INSERT INTO audit (id, org_id, actor_user_id, action, target, at, detail) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), org, actor, action, target, Date.now(), detail === null ? null : JSON.stringify(detail)).run().then(() => {});

/** /api/orgs: the list and making one. */
export async function orgListRoutes(req: Request, env: Env, user: User): Promise<Response | null> {
  if (req.method === "GET") { await ensureOwnOrg(env, user); return json(await listOrgs(env, user)); }
  if (req.method !== "POST") return null;
  if (user.key) return error(403, "API keys can't make orgs: sign in on the site");
  const b = await readBody<{ name?: unknown }>(req);
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 120) : "";
  if (!name) return error(400, "name: what to call the org");
  const own = await orgRow(env, await orgId(user.id, env.BETTER_AUTH_SECRET!));
  return json(await createOrg(env, user, name, "free", own ? `/${crypto.randomUUID()}` : ""), 201);
}

const userByEmail = (env: Env, email: string) =>
  env.DB.prepare('SELECT id, email, name FROM "user" WHERE lower(email) = ?').bind(email.trim().toLowerCase()).first<{ id: string; email: string; name: string }>();

/** Add `email`'s account to `org` as `role`, if the actor's role allows it. Shared with admin.ts. */
export async function addMember(env: Env, org: string, actor: User, actorRole: Role, email: unknown, role: unknown) {
  const r = role === undefined ? DEFAULT_ROLE : role;
  if (!isRole(r) || !GRANTABLE.includes(r)) return error(400, `role: one of ${GRANTABLE.join(", ")}`);
  if (!canSetRole(actorRole, r)) return error(403, `a ${actorRole} can't grant ${r}`);
  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+$/.test(email)) return error(400, "email: the account to add");
  const u = await userByEmail(env, email);
  if (!u) return error(404, "no account with that email: they sign up first");
  if (await memberOf(env, org, u.id)) return error(409, "already a member");
  await env.DB.prepare("INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)").bind(org, u.id, r, Date.now()).run();
  await writeAudit(env, org, actor.id, "member.add", u.id, { role: r });
  await emit(env, org, "member.added", { user_id: u.id, role: r });
  return json({ user_id: u.id, name: u.name, role: r }, 201);
}

export async function orgRoutes(c: Ctx): Promise<Response | null> {
  const { req, env, user, org, role, p } = c;
  if (!p[0]) {
    if (req.method === "GET") return json({ ...(await orgRow(env, org)), role });
    if (req.method === "DELETE") {
      if (!can(role, "org:delete")) return error(403, "admins delete orgs");
      await deleteOrg(env, org);
      return json({ ok: true });
    }
    return null;
  }
  if (p[0] !== "members") return null;
  if (!p[1] && req.method === "GET") {
    const { results } = await env.DB.prepare('SELECT m.user_id, u.name, u.email, m.role, m.created_at FROM memberships m JOIN "user" u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY m.created_at').bind(org).all();
    return json(results);
  }
  if (!can(role, "members")) return error(403, "managers and up manage members");
  if (!p[1] && req.method === "POST") {
    const b = await readBody<{ email?: unknown; role?: unknown }>(req);
    return addMember(env, org, user, role, b?.email, b?.role);
  }
  if (!p[1] || p[2]) return null;
  const target = await memberOf(env, org, p[1]);
  if (!target) return error(404, "not a member");
  if (!canSetRole(role, target)) return error(403, `a ${role} can't change a ${target}`);
  const lastAdmin = async () => target === "admin" && (await env.DB.prepare("SELECT count(*) AS n FROM memberships WHERE org_id = ? AND role = 'admin'").bind(org).first<{ n: number }>())!.n < 2;
  if (req.method === "PUT") {
    const b = await readBody<{ role?: unknown }>(req);
    const r = b?.role;
    if (!isRole(r) || !GRANTABLE.includes(r)) return error(400, `role: one of ${GRANTABLE.join(", ")}`);
    if (!canSetRole(role, r)) return error(403, `a ${role} can't grant ${r}`);
    if (r !== "admin" && (await lastAdmin())) return error(409, "the org needs at least one admin");
    await env.DB.prepare("UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?").bind(r, org, p[1]).run();
    await c.audit("member.role", p[1], { from: target, to: r });
    await emit(env, org, "member.changed", { user_id: p[1], role: r });
    return json({ user_id: p[1], role: r });
  }
  if (req.method === "DELETE") {
    const o = await orgRow(env, org);
    if (o?.owner_user_id === p[1] && rank(role) < rank("admin")) return error(403, "the org's owner stays until an admin says otherwise");
    if (await lastAdmin()) return error(409, "the org needs at least one admin");
    await env.DB.prepare("DELETE FROM memberships WHERE org_id = ? AND user_id = ?").bind(org, p[1]).run();
    await c.audit("member.remove", p[1], { role: target });
    await emit(env, org, "member.removed", { user_id: p[1] });
    return json({ ok: true });
  }
  return null;
}
