// The security audit log (#648): a trail of what changes who can get in, beyond the
// row it changes. Append-only (a trigger refuses updates); a row goes only with an
// account that's erased (privacy.ts). Each says who, signed in how, did what, in
// which repo, to what, when, and from which country.
//
// What's logged:
//   token.create / token.revoke            a personal API token (tokens.ts)
//   ci_token.create / ci_token.revoke      a repo's CI token (gh-compat.ts)
//   crew.add / crew.remove                 someone into or out of a repo's crew
//   invite.create / invite.revoke / invite.claim   (invites.ts)
//   repo.visibility / repo.delete
//   hook.create / hook.delete              a webhook (hooks.ts)
//   deploy_key.set / deploy_key.delete     a hosted deploy's key (deploy-keys.ts)
//
//   GET /api/repos/:o/:r/audit   the repo's last 100 (owner only), on its settings
//   GET /api/tokens/audit        what you did, the last 100 (cookie only), on your tokens page

import { json, type Env } from "./env.ts";

export type Via = "cookie" | "token" | "oauth" | "job" | "invite";
/** What each request was signed in with, set where it's identified (worker.ts). */
export const via = new WeakMap<Request, Via>();

export interface Entry { actor: string | null; action: string; owner?: string; repo?: string; target?: string | null; detail?: string | null; via?: Via }

const LIMIT = 100;
const COLUMNS = "id, at, actor, via, action, owner, repo, target, detail, country";

/** Log one. Never in the way of what happened: a failed write is only reported. */
export async function audit(env: Env, req: Request, e: Entry) {
  const country = (req as { cf?: { country?: string } }).cf?.country ?? req.headers.get("cf-ipcountry");
  try {
    await env.DB.prepare("INSERT INTO audit (at, actor, via, action, owner, repo, target, detail, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(Date.now(), e.actor, e.via ?? via.get(req) ?? "cookie", e.action, e.owner ?? null, e.repo ?? null, e.target ?? null, e.detail ?? null, country || null).run();
  } catch (err) {
    console.error("codeSplitter: audit write failed", e.action, String((err as Error)?.message ?? err));
  }
}

export async function auditRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (req.method !== "GET") return null;
  if (p[1] === "tokens" && p[2] === "audit" && !p[3]) {
    if (!user) return json({ error: "sign in first" }, 401);
    const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM audit WHERE actor = ? ORDER BY id DESC LIMIT ${LIMIT}`).bind(user).all();
    return json(results);
  }
  if (p[1] === "repos" && p[2] && p[3] && p[4] === "audit" && !p[5]) {
    // Who's in the crew and how they got there is the owner's to see.
    if (user !== p[2]) return json({ error: "owner only" }, 403);
    const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM audit WHERE owner = ? AND repo = ? ORDER BY id DESC LIMIT ${LIMIT}`).bind(p[2], p[3]).all();
    return json(results);
  }
  return null;
}
