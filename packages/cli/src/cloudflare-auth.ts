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
import { homedir } from "node:os";
import { join } from "node:path";
import type { RustyBunsConfig } from "./config.ts";
import { workspaceRoot } from "./glue/deploy-deps.ts";

/** Every Worker deploy: find the account, upload the script, its Durable Objects and workers.dev route. */
export const BASE_SCOPES = ["account:read", "user:read", "workers:write", "workers_scripts:write", "workers_routes:write", "workers_tail:read"];
/** Bindings Alchemy provisions through their own API. R2, DOs, Hyperdrive, vars and secrets ride on workers:write. */
const BY_BINDING: Record<string, string[]> = {
  d1: ["d1:write"],
  kv: ["workers_kv:write"],
  queue: ["queues:write"],
  artifacts: ["artifacts:write"],
  send_email: ["email_sending:write"],
  container: ["containers:write", "cloudchamber:write"],
  // Wrangler's OAuth list has no Vectorize scope; its vectorize commands run on ai:write.
  vectorize: ["ai:write"],
  ai: ["ai:write"],
};

/** The wrangler OAuth scopes this app's edge stack needs, and no others. */
export function cloudflareScopes(c: RustyBunsConfig): string[] {
  const s = new Set(BASE_SCOPES);
  for (const b of Object.values(c.bindings ?? {})) for (const x of BY_BINDING[b.type] ?? []) s.add(x);
  if (c.targets.edge?.domain || c.targets.edge?.routes?.length) s.add("zone:read");   // a custom domain or route is looked up in its zone
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
    // `export CLOUDFLARE_API_TOKEN=$(failing command)` leaves an empty string: say so instead of silently using a stale profile.
    if (env.CLOUDFLARE_API_TOKEN === "") log("Cloudflare: CLOUDFLARE_API_TOKEN is set but empty (did the command that fills it fail?), so it is ignored.");
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

/** Cloudflare's HTTP status for this token on this account (200 when it takes it); null when Cloudflare couldn't be reached. */
export type TokenCheck = (token: string, accountId: string) => Promise<number | null>;

/**
 * The account itself (wrangler's OAuth carries account:read), else the token's own verify
 * endpoint, user or account owned: a Workers-only API token may not read the account but is still good.
 */
export const realTokenCheck: TokenCheck = async (token, accountId) => {
  const api = "https://api.cloudflare.com/client/v4";
  const account = `${api}/accounts/${encodeURIComponent(accountId)}`;
  let first: number | null = null;
  for (const url of [account, `${api}/user/tokens/verify`, `${account}/tokens/verify`]) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      if (r.ok) return r.status;
      first ??= r.status;
    } catch { return null; }
  }
  return first;
};

/** Where Alchemy keeps the selected profile's Cloudflare login (ALCHEMY_HOME, ALCHEMY_PROFILE). */
export function alchemyCloudflareProfile(env: Record<string, string | undefined>): string {
  return join(env.ALCHEMY_HOME ?? join(homedir(), ".alchemy"), "profiles", env.ALCHEMY_PROFILE || "default", "cloudflare.json");
}

const LOGIN_FIX = "Run `rustybuns login cloudflare`, or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.";

/**
 * Checked before the build (#1170): no Cloudflare login, or a token Cloudflare
 * refuses, is one line here instead of a whole build and then Alchemy's stack
 * trace. `env` is what Alchemy will get, wrangler's token included. Same order
 * as Alchemy: a full set of env credentials, else (outside CI) its profile.
 * null when it looks fine, or when Cloudflare can't be reached to ask.
 */
export async function cloudflareProblem(env: Record<string, string | undefined>, check: TokenCheck,
  hasFile: (path: string) => boolean = existsSync): Promise<string | null> {
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (account && env.CLOUDFLARE_API_TOKEN) {
    const status = await check(env.CLOUDFLARE_API_TOKEN, account);
    if (status !== null && status >= 400 && status < 500)
      return `Cloudflare refused the API token for account ${account} (HTTP ${status}). ${LOGIN_FIX}`;
    return null;
  }
  if (account && env.CLOUDFLARE_API_KEY && (env.CLOUDFLARE_EMAIL || env.CLOUDFLARE_ACCOUNT_EMAIL)) return null;
  // Alchemy reads no profile in CI, only the environment.
  if (env.CI && !/^(0|false)$/i.test(env.CI)) return "no Cloudflare credentials in CI. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.";
  if (hasFile(alchemyCloudflareProfile(env))) return null;
  return `not logged in to Cloudflare${env.CLOUDFLARE_API_TOKEN ? " (CLOUDFLARE_API_TOKEN is set, but Alchemy ignores it without CLOUDFLARE_ACCOUNT_ID)" : ""}. ${LOGIN_FIX}`;
}

/**
 * `env` with CLOUDFLARE_ACCOUNT_ID set to targets.edge.accountId. One exported for another
 * account is refused rather than picked: a deploy to the wrong account makes a second copy there.
 */
export function withAccount<E extends Record<string, string | undefined>>(c: Pick<RustyBunsConfig, "targets"> | undefined, env: E): E {
  const want = c?.targets.edge?.accountId;
  if (!want) return env;
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== want)
    throw new Error(`targets.edge.accountId is ${want}, but CLOUDFLARE_ACCOUNT_ID is ${env.CLOUDFLARE_ACCOUNT_ID}. Unset one, or make them agree.`);
  return { ...env, CLOUDFLARE_ACCOUNT_ID: want };
}
