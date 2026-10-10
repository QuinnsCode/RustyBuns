// Cloudflare credentials for plan, deploy and destroy, from wrangler's login.
//
// Alchemy's own OAuth asks for scopes from its whole catalogue, and Cloudflare
// refuses the entire request ("did not authorize") when any one of them isn't
// offered. Wrangler logs in with an exact list instead, so we ask for only what
// this app's bindings need, and hand Alchemy the token through the environment
// (CLOUDFLARE_API_TOKEN wins over any Alchemy profile). Already logged in with
// those scopes: no prompt at all.

import type { RustyBunsConfig } from "./config.ts";

/** Every Worker deploy: find the account, upload the script, its Durable Objects and workers.dev route. */
const BASE = ["account:read", "user:read", "workers:write", "workers_scripts:write", "workers_routes:write", "workers_tail:read"];
const BY_BINDING: Record<string, string[]> = {
  d1: ["d1:write"],
  kv: ["workers_kv:write"],
  artifacts: ["artifacts:write"],
  container: ["containers:write", "cloudchamber:write"],
};

/** The wrangler OAuth scopes this app's edge stack needs, and no others. */
export function cloudflareScopes(c: RustyBunsConfig): string[] {
  const s = new Set(BASE);
  for (const b of Object.values(c.bindings ?? {})) for (const x of BY_BINDING[b.type] ?? []) s.add(x);
  return [...s];
}

interface WhoAmI { loggedIn: boolean; accounts?: { id: string; name: string }[]; tokenPermissions?: string[] }

async function wranglerJson<T>(args: string[]): Promise<T | null> {
  const p = Bun.spawn(["bunx", "wrangler", ...args, "--json"], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  try { return JSON.parse(out) as T; } catch { return null; }
}

/**
 * CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for Alchemy. Logs in with
 * wrangler first (one browser click) when there's no login or it lacks a scope.
 * Nothing when the shell already brings its own Cloudflare credentials.
 */
export async function cloudflareEnv(c: RustyBunsConfig, env: Record<string, string | undefined>): Promise<Record<string, string>> {
  if (env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_KEY) return {};
  const need = cloudflareScopes(c);
  const missing = (me: WhoAmI | null) => need.filter((s) => !(me?.tokenPermissions ?? []).includes(s));
  let me = await wranglerJson<WhoAmI>(["whoami"]);
  if (!me?.loggedIn || missing(me).length > 0) {
    console.log(me?.loggedIn
      ? `Cloudflare: your wrangler login lacks ${missing(me).join(", ")}. Logging in again with exactly what this app needs:`
      : "Cloudflare: logging in with exactly the scopes this app needs:");
    console.log(`  ${need.join(" ")}\n`);
    const p = Bun.spawn(["bunx", "wrangler", "login", "--scopes", ...need], { stdio: ["inherit", "inherit", "inherit"] });
    if ((await p.exited) !== 0) throw new Error("wrangler login did not finish. Run `rustybuns plan` again to retry.");
    me = await wranglerJson<WhoAmI>(["whoami"]);
    if (!me?.loggedIn) throw new Error("wrangler still isn't logged in to Cloudflare.");
  }
  const accounts = me.accounts ?? [];
  const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? (accounts.length === 1 ? accounts[0]!.id : undefined);
  if (!accountId) {
    throw new Error(`this login reaches ${accounts.length} Cloudflare accounts. Pick one with CLOUDFLARE_ACCOUNT_ID=<id>:\n` +
      accounts.map((a) => `  ${a.id}  ${a.name}`).join("\n"));
  }
  const t = await wranglerJson<{ token?: string }>(["auth", "token"]);
  if (!t?.token) throw new Error("couldn't read wrangler's Cloudflare token (`wrangler auth token`).");
  return { CLOUDFLARE_API_TOKEN: t.token, CLOUDFLARE_ACCOUNT_ID: accountId };
}
