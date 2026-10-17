// The API: every /api/* request comes here from worker.tsx (and from src/local.ts in tests),
// every HOOKS message to handleQueue. A small manual router: method and path segments.
//
//   /api/auth/*          Better Auth (rate limited: 20 a minute per IP, across isolates)
//   /api/openapi.json    the spec            /api/mcp   the MCP server
//   /api/demo            a throwaway account
//   /api/me, /api/admin/*, /api/orgs, /api/orgs/:org/*   signed in (key or cookie)
//
// Under /api/orgs/:org everything is 404 to a non-member, so an id never says whether it exists.
// Nothing here logs an email or a row.

import { adminRoutes } from "./admin.ts";
import { accountsOff, accountsOn, authFor, crossSite, keyRoutes, providers, sessionUser } from "./auth.ts";
import { crmRoutes } from "./crm.ts";
import { demoRoute } from "./demo.ts";
import { error, json, type Env, type HookMessage } from "./env.ts";
import { insightRoutes } from "./insights.ts";
import { mcp } from "./mcp.ts";
import { oauthRoutes, wellKnown } from "./oauth.ts";
import { exportRoutes, meRoutes } from "./me.ts";
import { openapi } from "./openapi.ts";
import { orgListRoutes, orgRoutes, orgRow, roleIn, writeAudit, type Ctx } from "./orgs.ts";
import { can, type Action } from "./rbac.ts";
import { scriptRoutes } from "./scripts.ts";
import { seedRoutes } from "./seed-data.ts";
import { syncRoutes } from "./sync.ts";
import { deliver, webhookRoutes } from "./webhooks.ts";

/** Sign-in attempts per IP per minute, counted by the AUTH_LIMIT binding (rustybuns.config.ts) at each location. */
async function limited(req: Request, env: Env) {
  // Cloudflare always sets the header; without it or the binding (the desktop, the tests) there is one person and no limit.
  const ip = req.headers.get("cf-connecting-ip");
  if (!ip || !env.AUTH_LIMIT) return false;
  return !(await env.AUTH_LIMIT.limit({ key: ip })).success;
}

/** The least role each org sub-route takes, before its own checks. */
const GUARDS: Record<string, Action> = { webhooks: "webhooks", keys: "keys", seed: "seed", export: "export", audit: "audit" };
const ORG_ROUTES = [orgRoutes, crmRoutes, syncRoutes, webhookRoutes, keyRoutes, seedRoutes, insightRoutes, exportRoutes];

async function route(req: Request, env: Env, defer?: Defer): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const origin = env.BETTER_AUTH_URL ?? url.origin;
  const known = wellKnown(req, p, origin);
  if (known) return known;
  if (p[0] !== "api") return error(404, "not found");
  if (p[1] === "auth") {
    if (await limited(req, env)) return json({ error: "too many sign-in attempts: wait a minute" }, 429, { "retry-after": "60" });
    return accountsOn(env) ? authFor(req, env).handler(req) : accountsOff();
  }
  if (p[1] === "openapi.json" && !p[2]) return json(openapi(origin));
  if (p[1] === "mcp" && !p[2]) return mcp(req, env, (r) => handleApi(r, env));
  if (!accountsOn(env)) return accountsOff();
  // Which sign-in methods the form offers: public, it has to load before anyone is signed in.
  if (p[1] === "providers" && !p[2] && req.method === "GET") return json(providers(env));
  if (p[1] === "demo" && !p[2]) return demoRoute(req, env, defer);
  const oauth = await oauthRoutes(req, env, p, url, origin);
  if (oauth) return oauth;

  const refused = crossSite(req, env);
  if (refused) return refused;
  const user = await sessionUser(req, env);
  if (user instanceof Response) return user;
  if (!user) return error(401, "sign in first");

  let res: Response | null = null;
  if (p[1] === "me" && !p[2]) res = await meRoutes(req, env, url, user);
  else if (p[1] === "admin") res = await adminRoutes(req, env, user, p.slice(2));
  else if (p[1] === "orgs" && !p[2]) res = await orgListRoutes(req, env, user);
  else if (p[1] === "orgs" && p[2]) {
    const org = p[2];
    const role = await roleIn(env, org, user);
    if (!role || (role === "super_admin" && !(await orgRow(env, org)))) return error(404, "not found");
    const need = GUARDS[p[3] ?? ""];
    if (need && !can(role, need)) return error(403, `a ${role} can't do that`);
    const ctx: Ctx = { req, env, url, user, org, role, p: p.slice(3), audit: (action, target, detail) => writeAudit(env, org, user.id, action, target, detail) };
    // A script's calls come back in through the whole API, as the person who pressed run.
    res = await scriptRoutes(ctx, (r) => handleApi(r, env));
    for (const r of ORG_ROUTES) if (res || (res = await r(ctx))) break;
  }
  return res ?? error(404, "not found");
}

/** Runs work after the response is sent (the Worker's waitUntil); without one, the caller waits for it. */
export type Defer = (work: Promise<unknown>) => void;

export async function handleApi(req: Request, env: Env, defer?: Defer): Promise<Response> {
  let res = await route(req, env, defer);
  // Better Auth's responses come with frozen headers; ours don't.
  try { res.headers.set("x-content-type-options", "nosniff"); } catch { res = new Response(res.body, res); res.headers.set("x-content-type-options", "nosniff"); }
  res.headers.set("cache-control", "no-store");
  return res;
}

/** The HOOKS queue's consumer: one webhook try per message. */
export async function handleQueue(batch: { messages: readonly { body: HookMessage; ack(): void }[] }, env: Env) {
  await Promise.all(batch.messages.map(async (m) => {
    try { await deliver(env, m.body); } catch { /* the row keeps its state; the hourly sweep re-queues what is due */ }
    m.ack();
  }));
}
