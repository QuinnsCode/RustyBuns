// The super admin's routes (SUPER_ADMIN_EMAIL): every org, and putting someone into one.
//
//   GET  /api/admin/orgs                                 every org with its member count
//   POST /api/admin/orgs/:org/members {email, role?}     add an account to any org, any role but super_admin

import type { User } from "./auth.ts";
import { error, json, readBody, type Env } from "./env.ts";
import { addMember, orgRow, superAdmin } from "./orgs.ts";

export async function adminRoutes(req: Request, env: Env, user: User, p: string[]): Promise<Response | null> {
  if (p[0] !== "orgs") return null;
  if (!superAdmin(env, user)) return error(403, "super admin only");
  if (!p[1] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT o.id, o.name, o.plan, o.owner_user_id, o.created_at, (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS members FROM orgs o ORDER BY o.created_at").all();
    return json(results);
  }
  if (p[1] && p[2] === "members" && !p[3] && req.method === "POST") {
    if (!(await orgRow(env, p[1]))) return error(404, "no such org");
    const b = await readBody<{ email?: unknown; role?: unknown }>(req);
    return addMember(env, p[1], user, "super_admin", b?.email, b?.role);
  }
  return null;
}
