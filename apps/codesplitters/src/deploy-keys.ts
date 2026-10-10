// Hosted deploys' keys: a scoped token per provider (Cloudflare's with its
// account; Railway's or Hetzner's for a box target) the repo's owner stores so
// the site can deploy the repo without the owner's machine.
//
// Write-only: the owner sets, replaces or removes each, and the API never hands
// it back, only who set it, when, and its last 4 characters. It's sealed with
// AES-GCM under DEPLOY_SECRETS_KEY (a Worker secret, 32 random bytes in
// base64), bound to its repo and provider so a sealed key can't be moved to
// another one. It is only unsealed inside a deploy run, into the env of that
// run's own container (deploy-runner.ts); agent containers never see it.
//
// Rotating DEPLOY_SECRETS_KEY: deploy with the new one, and the old one as
// DEPLOY_SECRETS_KEY_OLD. Everything sealed still opens, under either, and an
// admin's re-seal (the admin page's button) seals every key and every runner's
// Alchemy state under the new one. Then DEPLOY_SECRETS_KEY_OLD can go.
//
// Hosted deploys are off unless the site was deployed with CODESPLITTERS_DEPLOYS=1
// (which binds DEPLOY_RUNNER), need accounts on (with aliases anyone can claim
// a handle), and are limited to owners in ADMINS, like hosted agents.
//
//   GET    /api/repos/:o/:r/deploy/key[/:provider]   {set, by, at, last4} (owner only); Cloudflare's without a provider
//   PUT    /api/repos/:o/:r/deploy/key[/:provider]   {token, account_id (Cloudflare's only)}
//   DELETE /api/repos/:o/:r/deploy/key[/:provider]
//   GET    /api/admin/deploy-keys                    {rotating, keys} (admins)
//   POST   /api/admin/deploy-keys/reseal             {keys, states, failed}

import { json, type Env } from "./env.ts";
import { accountsOn, isAdmin } from "./identity.ts";

export interface DeployKey { token: string; account_id?: string }
export type Provider = "cloudflare" | "railway" | "hetzner";

/** Each provider: the env its CLI reads in the deploy container, and what its token should be. */
export const PROVIDERS: Record<Provider, { env: (k: DeployKey) => Record<string, string>; token: string }> = {
  cloudflare: {
    env: (k) => ({ CLOUDFLARE_API_TOKEN: k.token, CLOUDFLARE_ACCOUNT_ID: k.account_id ?? "" }),
    token: "a Cloudflare API token (scoped: Workers edit on one account, plus D1/R2 if the app binds them)",
  },
  railway: { env: (k) => ({ RAILWAY_API_TOKEN: k.token }), token: "a Railway team token (scoped to one team, not your account's)" },
  hetzner: { env: (k) => ({ HCLOUD_TOKEN: k.token }), token: "a Hetzner Cloud API token (read & write, made in the one project it deploys to)" },
};
const NAMES = Object.keys(PROVIDERS) as Provider[];
const isProvider = (p: string): p is Provider => (NAMES as string[]).includes(p);

/** Why `user` can't deploy from the site, or null when they can. */
export function hostedWhy(env: Env, user: string | null): string | null {
  if (!env.DEPLOY_RUNNER) return "hosted deploys are off on this site (CODESPLITTERS_DEPLOYS=1)";
  if (!accountsOn(env)) return "hosted deploys need accounts on (BETTER_AUTH_SECRET): with aliases anyone can claim a handle";
  if (!env.DEPLOY_SECRETS_KEY) return "hosted deploys need DEPLOY_SECRETS_KEY to seal deploy keys";
  if (!user || user.startsWith("agent-")) return "only a person deploys";
  if (!(env.ADMINS && isAdmin(env, user))) return "hosted deploys are limited to this site's admins (ADMINS)";
  return null;
}

const b64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aes(secret: string | undefined, name: string) {
  let raw = new Uint8Array();
  try { raw = unb64(secret ?? ""); } catch {}
  if (raw.length !== 32) throw new Error(`${name} must be 32 bytes in base64 (openssl rand -base64 32)`);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
/** Bound to what it is and whose: a sealed value opens only as that. */
const aad = (what: string) => new TextEncoder().encode(`codesplitters ${what}`);

async function sealText(env: Env, what: string, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(what) }, await aes(env.DEPLOY_SECRETS_KEY, "DEPLOY_SECRETS_KEY"), new TextEncoder().encode(text)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64(out);
}

/** Open under DEPLOY_SECRETS_KEY, or, while it's being rotated, DEPLOY_SECRETS_KEY_OLD (`stale`). */
async function open(env: Env, what: string, sealed: string): Promise<{ text: string; stale: boolean }> {
  const raw = unb64(sealed), alg = { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: aad(what) };
  const key = await aes(env.DEPLOY_SECRETS_KEY, "DEPLOY_SECRETS_KEY");
  try {
    return { text: new TextDecoder().decode(await crypto.subtle.decrypt(alg, key, raw.slice(12))), stale: false };
  } catch (e) {
    if (!env.DEPLOY_SECRETS_KEY_OLD) throw e;
    const old = await aes(env.DEPLOY_SECRETS_KEY_OLD, "DEPLOY_SECRETS_KEY_OLD");
    return { text: new TextDecoder().decode(await crypto.subtle.decrypt(alg, old, raw.slice(12))), stale: true };
  }
}
const unsealText = async (env: Env, what: string, sealed: string) => (await open(env, what, sealed)).text;
/** Sealed again under DEPLOY_SECRETS_KEY, or null when it already is. Throws when it opens under neither key. */
async function resealText(env: Env, what: string, sealed: string): Promise<string | null> {
  const { text, stale } = await open(env, what, sealed);
  return stale ? sealText(env, what, text) : null;
}

/** Cloudflare's keys were the only kind at first, so theirs keeps the original binding. */
const keyWhat = (owner: string, repo: string, provider: Provider) => `deploy key ${owner}/${repo}${provider === "cloudflare" ? "" : ` ${provider}`}`;
export const seal = (env: Env, owner: string, repo: string, key: DeployKey, provider: Provider = "cloudflare") => sealText(env, keyWhat(owner, repo, provider), JSON.stringify(key));
export const unseal = async (env: Env, owner: string, repo: string, sealed: string, provider: Provider = "cloudflare"): Promise<DeployKey> => JSON.parse(await unsealText(env, keyWhat(owner, repo, provider), sealed));

/** A repo's Alchemy state between hosted deploys (deploy-runner.ts): it holds the app's secrets, so it's sealed too. */
const stateWhat = (owner: string, repo: string) => `alchemy state ${owner}/${repo}`;
export const sealState = (env: Env, owner: string, repo: string, files: Record<string, string>) => sealText(env, stateWhat(owner, repo), JSON.stringify(files));
export const unsealState = async (env: Env, owner: string, repo: string, sealed: string): Promise<Record<string, string>> => JSON.parse(await unsealText(env, stateWhat(owner, repo), sealed));
export const resealState = (env: Env, owner: string, repo: string, sealed: string) => resealText(env, stateWhat(owner, repo), sealed);

/** The repo's keys, unsealed: for a deploy run only. */
export async function deployKeys(env: Env, owner: string, repo: string): Promise<Partial<Record<Provider, DeployKey & { last4: string }>>> {
  const { results } = await env.DB.prepare("SELECT provider, sealed, last4 FROM deploy_keys WHERE owner = ? AND repo = ?").bind(owner, repo).all();
  const out: Partial<Record<Provider, DeployKey & { last4: string }>> = {};
  for (const r of results as { provider: Provider; sealed: string; last4: string }[]) {
    if (isProvider(r.provider)) out[r.provider] = { ...(await unseal(env, owner, repo, r.sealed, r.provider)), last4: r.last4 };
  }
  return out;
}

/** The env a deploy container gets from these keys. */
export const keyEnv = (keys: Partial<Record<Provider, DeployKey>>) =>
  Object.assign({}, ...NAMES.filter((p) => keys[p]).map((p) => PROVIDERS[p].env(keys[p]!))) as Record<string, string>;

type KeyInfo = { set: false } | { set: true; by: string; at: number; last4: string };

/** What anyone, the owner included, may see about one key. */
export async function keyInfo(env: Env, owner: string, repo: string, provider: Provider = "cloudflare"): Promise<KeyInfo> {
  const r = await env.DB.prepare("SELECT last4, set_by, set_at FROM deploy_keys WHERE owner = ? AND repo = ? AND provider = ?").bind(owner, repo, provider).first();
  return r ? { set: true, by: r.set_by, at: r.set_at, last4: r.last4 } : { set: false };
}

/** Every provider's key, as keyInfo shows it. */
export async function keysInfo(env: Env, owner: string, repo: string): Promise<Record<Provider, KeyInfo>> {
  return Object.fromEntries(await Promise.all(NAMES.map(async (p) => [p, await keyInfo(env, owner, repo, p)]))) as Record<Provider, KeyInfo>;
}

/** Which keys a deploy used, for its log line: `…WXYZ` for Cloudflare's, `railway …1234` for the others. */
export const keysLabel = (keys: Record<Provider, KeyInfo>) =>
  NAMES.flatMap((p) => { const k = keys[p]; return k.set ? [`${p === "cloudflare" ? "" : `${p} `}…${k.last4}`] : []; }).join(", ") || undefined;

const ACCOUNT = /^[0-9a-f]{32}$/;

export async function deployKeyRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "deploy" && p[5] === "key" && !p[7])) return null;
  const [owner, repo, provider] = [p[2], p[3], p[6] ?? "cloudflare"];
  if (!isProvider(provider)) return json({ error: `no such provider: ${provider} (${NAMES.join(", ")})` }, 404);
  if (user !== owner) return json({ error: "only the repo's owner can manage its deploy keys" }, 403);
  if (!(await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first())) return json({ error: "not found" }, 404);

  if (req.method === "GET") return json({ ...(await keyInfo(env, owner, repo, provider)), hosted: !hostedWhy(env, user), why: hostedWhy(env, user) });
  if (req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM deploy_keys WHERE owner = ? AND repo = ? AND provider = ?").bind(owner, repo, provider).run();
    return json(await keyInfo(env, owner, repo, provider));
  }
  if (req.method === "PUT") {
    const why = hostedWhy(env, user);
    if (why) return json({ error: why }, 403);
    const { token, account_id } = (await req.json().catch(() => ({}))) as Partial<DeployKey>;
    const t = String(token ?? "").trim(), a = String(account_id ?? "").trim().toLowerCase();
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(t)) return json({ error: `token: ${PROVIDERS[provider].token}` }, 400);
    if (provider === "cloudflare" && !ACCOUNT.test(a)) return json({ error: "account_id: the 32-character Cloudflare account ID the token is scoped to" }, 400);
    const sealed = await seal(env, owner, repo, provider === "cloudflare" ? { token: t, account_id: a } : { token: t }, provider);
    await env.DB.prepare(`INSERT INTO deploy_keys (owner, repo, provider, sealed, last4, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, repo, provider) DO UPDATE SET sealed = excluded.sealed, last4 = excluded.last4, set_by = excluded.set_by, set_at = excluded.set_at`)
      .bind(owner, repo, provider, sealed, t.slice(-4), user, Date.now()).run();
    return json(await keyInfo(env, owner, repo, provider));
  }
  return null;
}

/** Seal every stored key, and each repo's runner's Alchemy state, under DEPLOY_SECRETS_KEY. */
export async function resealAll(env: Env) {
  const out = { keys: 0, states: 0, failed: [] as string[] };
  const { results: keys } = await env.DB.prepare("SELECT owner, repo, provider, sealed FROM deploy_keys").all();
  for (const k of keys as { owner: string; repo: string; provider: Provider; sealed: string }[]) {
    try {
      const sealed = await resealText(env, keyWhat(k.owner, k.repo, k.provider), k.sealed);
      if (!sealed) continue;
      await env.DB.prepare("UPDATE deploy_keys SET sealed = ? WHERE owner = ? AND repo = ? AND provider = ? AND sealed = ?").bind(sealed, k.owner, k.repo, k.provider, k.sealed).run();
      out.keys++;
    } catch { out.failed.push(`${k.owner}/${k.repo} ${k.provider} key`); }
  }
  // Any repo that ever deployed from the site may have state, its key removed since or not.
  const { results: repos } = await env.DB.prepare("SELECT owner, repo FROM deploy_keys UNION SELECT owner, repo FROM deploys WHERE runner = 'hosted'").all();
  for (const r of repos as { owner: string; repo: string }[]) {
    const stub = env.DEPLOY_RUNNER?.get(env.DEPLOY_RUNNER.idFromName(`${r.owner}/${r.repo}`));
    if (!stub) break;
    const res = await stub.fetch(new Request("http://deploy/reseal", { method: "POST", body: JSON.stringify({ owner: r.owner, repo: r.repo }) })).catch(() => null);
    const d = (await res?.json().catch(() => null)) as { states: number; failed: string[] } | null;
    if (!d) { out.failed.push(`${r.owner}/${r.repo} state`); continue; }
    out.states += d.states;
    out.failed.push(...d.failed.map((f) => `${r.owner}/${r.repo} state${f}`));
  }
  return out;
}

export async function resealRoutes(req: Request, env: Env, p: string[], admin: boolean): Promise<Response | null> {
  if (!(p[1] === "admin" && p[2] === "deploy-keys")) return null;
  if (!admin) return json({ error: "admins only" }, 403);
  if (req.method === "GET" && !p[3]) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM deploy_keys").first();
    return json({ hosted: !!env.DEPLOY_RUNNER, rotating: !!env.DEPLOY_SECRETS_KEY_OLD, keys: n?.n ?? 0 });
  }
  if (req.method === "POST" && p[3] === "reseal" && !p[4]) {
    if (!env.DEPLOY_SECRETS_KEY) return json({ error: "DEPLOY_SECRETS_KEY isn't set" }, 400);
    return json(await resealAll(env));
  }
  return null;
}
