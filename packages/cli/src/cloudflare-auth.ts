// Cloudflare credentials for plan, deploy and destroy: wrangler's login first,
// Alchemy's own profile as the fallback.
//
// Alchemy's OAuth asks for scopes from its whole catalogue, and Cloudflare
// refuses the entire request ("did not authorize") when any one of them isn't
// offered. Wrangler logs in with an exact list instead, so we ask it for only
// what this app's bindings need and hand Alchemy the token through the
// environment (CLOUDFLARE_API_TOKEN wins over any Alchemy profile). Already
// logged in with those scopes: no prompt at all. No wrangler on this machine,
// or a login that doesn't finish: Alchemy's profile does what it did before.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RustyBunsConfig } from "./config.ts";
import { workspaceRoot } from "./glue/deploy-deps.ts";

/** Every Worker deploy: find the account, upload the script, its Durable Objects and workers.dev route. */
export const BASE_SCOPES = ["account:read", "user:read", "workers:write", "workers_scripts:write", "workers_routes:write", "workers_tail:read"];
/** Bindings Alchemy provisions through their own API. R2, DOs, vars and secrets ride on workers:write. */
const BY_BINDING: Record<string, string[]> = {
  d1: ["d1:write"],
  kv: ["workers_kv:write"],
  queue: ["queues:write"],
  artifacts: ["artifacts:write"],
  send_email: ["email_sending:write"],
  container: ["containers:write", "cloudchamber:write"],
};

/** The wrangler OAuth scopes this app's edge stack needs, and no others. */
export function cloudflareScopes(c: RustyBunsConfig): string[] {
  const s = new Set(BASE_SCOPES);
  for (const b of Object.values(c.bindings ?? {})) for (const x of BY_BINDING[b.type] ?? []) s.add(x);
  if (c.targets.edge?.domain) s.add("zone:read");   // a custom domain is looked up in its zone
  return [...s];
}

export interface WhoAmI {
  loggedIn: boolean;
  authType?: string;
  accounts?: { id: string; name: string }[];
  tokenPermissions?: string[];
}

/** The two wrangler calls cloudflareEnv makes, so a test can stand in for the real CLI. */
export interface Wrangler {
  /** `wrangler <args> --json`, parsed; null when it fails or prints no JSON. */
  json<T>(args: string[]): Promise<T | null>;
  /** `wrangler login --scopes ...` with the terminal attached; true when it finished. */
  login(scopes: string[]): Promise<boolean>;
}

/** wrangler from the project, the workspace root, or PATH. Never `bunx wrangler`: that fetches whatever is newest. */
export function wranglerCli(cwd = process.cwd()): string[] | null {
  const root = workspaceRoot(cwd);
  const local = [join(cwd, "node_modules", ".bin", "wrangler"), root && join(root, "node_modules", ".bin", "wrangler")]
    .find((p) => p && existsSync(p));
  const found = local || Bun.which("wrangler");
  return found ? [found] : null;
}

export function realWrangler(cli: string[]): Wrangler {
  return {
    async json<T>(args: string[]) {
      const p = Bun.spawn([...cli, ...args, "--json"], { stdout: "pipe", stderr: "pipe" });
      const out = await new Response(p.stdout).text();
      await p.exited;
      // --json keeps wrangler's banner off stdout; the braces guard against any stray line anyway.
      const body = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
      try { return JSON.parse(body) as T; } catch { return null; }
    },
    async login(scopes: string[]) {
      const p = Bun.spawn([...cli, "login", "--scopes", ...scopes], { stdio: ["inherit", "inherit", "inherit"] });
      return (await p.exited) === 0;
    },
  };
}

/** Scopes in `need` that wrangler's OAuth login doesn't carry. An API token login shows none, so it's trusted as is. */
export function missingScopes(need: string[], me: WhoAmI | null): string[] {
  if (me?.loggedIn && me.authType && me.authType !== "OAuth Token") return [];
  const have = me?.tokenPermissions ?? [];
  return need.filter((s) => !have.includes(s));
}

/**
 * CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for Alchemy, from wrangler's
 * login (logging in first, one browser click, when there's no login or it
 * lacks a scope). {} when the shell already brings its own Cloudflare
 * credentials. null when wrangler can't help (not installed, login not
 * finished, or no terminal to finish one in): the caller leaves Alchemy to its own profile.
 */
export async function cloudflareEnv(c: RustyBunsConfig, env: Record<string, string | undefined>, w: Wrangler | null, log: (s: string) => void = console.log,
  interactive = true): Promise<Record<string, string> | null> {
  if (env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_KEY) return {};
  if (!w) {
    log("Cloudflare: no wrangler in this project or on PATH, so Alchemy's own profile logs in (`rustybuns login cloudflare`). `bun add -d wrangler` to log in through wrangler with only the scopes this app needs.\n");
    return null;
  }
  const need = cloudflareScopes(c);
  let me = await w.json<WhoAmI>(["whoami"]);
  let missing = missingScopes(need, me);
  if (!me?.loggedIn || missing.length > 0) {
    // A browser login needs someone at a terminal; CI or a script would wait on it forever.
    if (!interactive) {
      log(`Cloudflare: wrangler ${me?.loggedIn ? `lacks ${missing.join(", ")}` : "isn't logged in"} and there's no terminal to log in from, so Alchemy's own profile is used. Set CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID), or run \`wrangler login --scopes ${need.join(" ")}\` once.\n`);
      return null;
    }
    log(me?.loggedIn
      ? `Cloudflare: your wrangler login lacks ${missing.join(", ")}. Logging in again with exactly what this app needs:`
      : "Cloudflare: logging in through wrangler with exactly the scopes this app needs:");
    log(`  ${need.join(" ")}\n`);
    if (!(await w.login(need))) {
      log("Cloudflare: wrangler login did not finish; falling back to Alchemy's own profile.\n");
      return null;
    }
    me = await w.json<WhoAmI>(["whoami"]);
    missing = missingScopes(need, me);
    if (!me?.loggedIn || missing.length > 0) {
      log(`Cloudflare: wrangler ${me?.loggedIn ? `still lacks ${missing.join(", ")}` : "still isn't logged in"}; falling back to Alchemy's own profile.\n`);
      return null;
    }
  }
  const accounts = me.accounts ?? [];
  const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? (accounts.length === 1 ? accounts[0]!.id : undefined);
  if (!accountId) {
    throw new Error(`this Cloudflare login reaches ${accounts.length} accounts. Pick one with CLOUDFLARE_ACCOUNT_ID=<id>:\n` +
      accounts.map((a) => `  ${a.id}  ${a.name}`).join("\n"));
  }
  const t = await w.json<{ token?: string }>(["auth", "token"]);
  if (!t?.token) {
    log("Cloudflare: couldn't read wrangler's token (`wrangler auth token`); falling back to Alchemy's own profile.\n");
    return null;
  }
  return { CLOUDFLARE_API_TOKEN: t.token, CLOUDFLARE_ACCOUNT_ID: accountId };
}
