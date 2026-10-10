// Hosted deploys' keys: a Cloudflare API token (and its account) the repo's
// owner stores so the site can deploy the repo without the owner's machine.
//
// Write-only: the owner sets, replaces or removes it, and the API never hands
// it back, only who set it, when, and its last 4 characters. It's sealed with
// AES-GCM under DEPLOY_SECRETS_KEY (a Worker secret, 32 random bytes in
// base64), bound to its repo so a sealed key can't be moved to another one.
// It is only unsealed inside a deploy run, into the env of that run's own
// container (deploy-runner.ts); agent containers never see it.
//
// Hosted deploys are off unless the site was deployed with CODESPLITTERS_DEPLOYS=1
// (which binds DEPLOY_RUNNER), need accounts on (with aliases anyone can claim
// a handle), and are limited to owners in ADMINS, like hosted agents.
//
//   GET    /api/repos/:o/:r/deploy/key   {set, by, at, last4, account_id} (owner only)
//   PUT    /api/repos/:o/:r/deploy/key   {token, account_id}
//   DELETE /api/repos/:o/:r/deploy/key

import { json, type Env } from "./env.ts";
import { accountsOn, isAdmin } from "./identity.ts";

export interface DeployKey { token: string; account_id: string }

/** Why `user` can't deploy from the site, or null when they can. */
export function hostedWhy(env: Env, user: string | null): string | null {
  if (!env.DEPLOY_RUNNER) return "hosted deploys are off on this site (CODESPLITTERS_DEPLOYS=1)";
  if (!accountsOn(env)) return "hosted deploys need accounts on (BETTER_AUTH_SECRET): with aliases anyone can claim a handle";
  if (!env.DEPLOY_SECRETS_KEY) return "hosted deploys need DEPLOY_SECRETS_KEY to seal deploy keys";
  if (!user || user.startsWith("agent-")) return "only a person deploys";
  if (!(env.ADMINS && isAdmin(env, user))) return "hosted deploys are limited to this site's admins (ADMINS)";
  return null;
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aes(env: Env) {
  let raw = new Uint8Array();
  try { raw = unb64(env.DEPLOY_SECRETS_KEY ?? ""); } catch {}
  if (raw.length !== 32) throw new Error("DEPLOY_SECRETS_KEY must be 32 bytes in base64 (openssl rand -base64 32)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const aad = (owner: string, repo: string) => new TextEncoder().encode(`codesplitters deploy key ${owner}/${repo}`);

export async function seal(env: Env, owner: string, repo: string, key: DeployKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(owner, repo) }, await aes(env), new TextEncoder().encode(JSON.stringify(key))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64(out);
}

export async function unseal(env: Env, owner: string, repo: string, sealed: string): Promise<DeployKey> {
  const raw = unb64(sealed);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12), additionalData: aad(owner, repo) }, await aes(env), raw.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}

/** The repo's key, unsealed: for a deploy run only. */
export async function deployKey(env: Env, owner: string, repo: string): Promise<(DeployKey & { last4: string }) | null> {
  const r = await env.DB.prepare("SELECT sealed, last4 FROM deploy_keys WHERE owner = ? AND repo = ?").bind(owner, repo).first();
  return r ? { ...(await unseal(env, owner, repo, r.sealed)), last4: r.last4 } : null;
}

/** What anyone, the owner included, may see about the key. */
export async function keyInfo(env: Env, owner: string, repo: string) {
  const r = await env.DB.prepare("SELECT last4, set_by, set_at FROM deploy_keys WHERE owner = ? AND repo = ?").bind(owner, repo).first();
  return r ? { set: true, by: r.set_by, at: r.set_at, last4: r.last4 } : { set: false };
}

const ACCOUNT = /^[0-9a-f]{32}$/;

export async function deployKeyRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "deploy" && p[5] === "key" && !p[6])) return null;
  const [owner, repo] = [p[2], p[3]];
  if (user !== owner) return json({ error: "only the repo's owner can manage its deploy key" }, 403);
  if (!(await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first())) return json({ error: "not found" }, 404);

  if (req.method === "GET") return json({ ...(await keyInfo(env, owner, repo)), hosted: !hostedWhy(env, user), why: hostedWhy(env, user) });
  if (req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM deploy_keys WHERE owner = ? AND repo = ?").bind(owner, repo).run();
    return json(await keyInfo(env, owner, repo));
  }
  if (req.method === "PUT") {
    const why = hostedWhy(env, user);
    if (why) return json({ error: why }, 403);
    const { token, account_id } = (await req.json().catch(() => ({}))) as Partial<DeployKey>;
    const t = String(token ?? "").trim(), a = String(account_id ?? "").trim().toLowerCase();
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(t)) return json({ error: "token: a Cloudflare API token (scoped: Workers edit on one account, plus D1/R2 if the app binds them)" }, 400);
    if (!ACCOUNT.test(a)) return json({ error: "account_id: the 32-character Cloudflare account ID the token is scoped to" }, 400);
    const sealed = await seal(env, owner, repo, { token: t, account_id: a });
    await env.DB.prepare(`INSERT INTO deploy_keys (owner, repo, sealed, last4, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, repo) DO UPDATE SET sealed = excluded.sealed, last4 = excluded.last4, set_by = excluded.set_by, set_at = excluded.set_at`)
      .bind(owner, repo, sealed, t.slice(-4), user, Date.now()).run();
    return json(await keyInfo(env, owner, repo));
  }
  return null;
}
