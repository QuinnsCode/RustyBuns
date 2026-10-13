import { test, expect } from "bun:test";
import { BASE_SCOPES, alchemyCloudflareProfile, cloudflareEnv, cloudflareProblem, cloudflareScopes, missingScopes, type WhoAmI, type Wrangler } from "../src/cloudflare-auth.ts";
import type { RustyBunsConfig } from "../src/config.ts";

const cfg = (bindings: RustyBunsConfig["bindings"], domain?: string): RustyBunsConfig => ({
  name: "game",
  worker: { main: "src/worker.ts", compatibilityDate: "2026-09-01", compatibilityFlags: [] },
  bindings,
  targets: { edge: { provider: "cloudflare", domain } },
});

const me = (over: Partial<WhoAmI> = {}): WhoAmI => ({
  loggedIn: true, authType: "OAuth Token", accounts: [{ id: "acct1", name: "One" }], tokenPermissions: [...BASE_SCOPES, "d1:write"], ...over,
});

/** A wrangler that answers whoami from `states` in turn and records logins. */
function fake(states: (WhoAmI | null)[], loginOk = true, token: string | null = "tok") {
  const logins: string[][] = [];
  const w: Wrangler = {
    async json<T>(args: string[]) {
      if (args[0] === "whoami") return (states.length > 1 ? states.shift()! : states[0]!) as T | null;
      if (args[0] === "auth") return { token } as T;
      throw new Error(`unexpected wrangler ${args.join(" ")}`);
    },
    async login(scopes) { logins.push(scopes); return loginOk; },
  };
  return { w, logins };
}
const quiet = () => {};

test("cloudflareScopes: the base set plus one per binding that has its own API; a domain adds zone:read", () => {
  expect(cloudflareScopes(cfg({}))).toEqual(BASE_SCOPES);
  const all = cloudflareScopes(cfg({
    DB: { type: "d1", databaseName: "db" }, KV: { type: "kv" }, FILES: { type: "r2", bucketName: "b" },
    WORLD: { type: "durable_object", className: "World" }, Q: { type: "queue", queueName: "q" },
    REPOS: { type: "artifacts", namespace: "n" }, MAIL: { type: "send_email" }, BOX: { type: "container", className: "Box", dockerfile: "Dockerfile" },
    KEY: { type: "secret" }, MODE: { type: "var", value: "x" },
  }, "game.example.com"));
  expect(all).toEqual([...BASE_SCOPES, "d1:write", "workers_kv:write", "queues:write", "artifacts:write", "email_sending:write", "containers:write", "cloudchamber:write", "zone:read"]);
});

test("missingScopes: what the OAuth login lacks; an API token login is trusted as is", () => {
  expect(missingScopes(["a", "b"], me({ tokenPermissions: ["a"] }))).toEqual(["b"]);
  expect(missingScopes(["a"], null)).toEqual(["a"]);
  expect(missingScopes(["a"], me({ authType: "User API Token", tokenPermissions: [] }))).toEqual([]);
});

test("cloudflareEnv: shell credentials win and wrangler is never asked", async () => {
  const { w, logins } = fake([null]);
  expect(await cloudflareEnv(cfg({}), { CLOUDFLARE_API_TOKEN: "x" }, w, quiet)).toEqual({});
  expect(logins).toEqual([]);
});

test("cloudflareEnv: a login with the scopes needs no prompt; the token and the one account go to Alchemy", async () => {
  const { w, logins } = fake([me()]);
  expect(await cloudflareEnv(cfg({ DB: { type: "d1", databaseName: "db" } }), {}, w, quiet)).toEqual({ CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acct1" });
  expect(logins).toEqual([]);
});

test("cloudflareEnv: a missing scope logs in again with exactly the app's scopes", async () => {
  const need = cloudflareScopes(cfg({ KV: { type: "kv" } }));
  const { w, logins } = fake([me(), me({ tokenPermissions: need })]);
  const lines: string[] = [];
  expect(await cloudflareEnv(cfg({ KV: { type: "kv" } }), {}, w, (s) => lines.push(s))).toEqual({ CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acct1" });
  expect(logins).toEqual([need]);
  expect(lines[0]).toContain("lacks workers_kv:write");
});

test("cloudflareEnv: not logged in and the login doesn't finish: Alchemy's profile takes over", async () => {
  const { w, logins } = fake([{ loggedIn: false }], false);
  const lines: string[] = [];
  expect(await cloudflareEnv(cfg({}), {}, w, (s) => lines.push(s))).toBeNull();
  expect(logins).toEqual([cloudflareScopes(cfg({}))]);
  expect(lines.at(-1)).toContain("falling back to Alchemy's own profile");
});

test("cloudflareEnv: no terminal (CI, a script): no browser login, Alchemy's profile, and how to give it a token", async () => {
  const { w, logins } = fake([{ loggedIn: false }]);
  const lines: string[] = [];
  expect(await cloudflareEnv(cfg({}), {}, w, (s) => lines.push(s), false)).toBeNull();
  expect(logins).toEqual([]);
  expect(lines.at(-1)).toContain("no terminal to log in from");
  expect(lines.at(-1)).toContain("CLOUDFLARE_API_TOKEN");
  // A login that already has every scope needs no terminal.
  expect(await cloudflareEnv(cfg({}), {}, fake([me()]).w, quiet, false)).toEqual({ CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acct1" });
});

test("cloudflareEnv: no wrangler at all: Alchemy's profile, with the way to get wrangler's", async () => {
  const lines: string[] = [];
  expect(await cloudflareEnv(cfg({}), {}, null, (s) => lines.push(s))).toBeNull();
  expect(lines[0]).toContain("bun add -d wrangler");
});

test("cloudflareEnv: several accounts need CLOUDFLARE_ACCOUNT_ID, which is then passed through", async () => {
  const two = me({ accounts: [{ id: "a1", name: "One" }, { id: "a2", name: "Two" }] });
  await expect(cloudflareEnv(cfg({}), {}, fake([two]).w, quiet)).rejects.toThrow("a2  Two");
  expect(await cloudflareEnv(cfg({}), { CLOUDFLARE_ACCOUNT_ID: "a2" }, fake([two]).w, quiet)).toEqual({ CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "a2" });
});

test("cloudflareEnv: no readable token: Alchemy's profile", async () => {
  expect(await cloudflareEnv(cfg({}), {}, fake([me()], true, null).w, quiet)).toBeNull();
});

test("cloudflareProblem: a token Cloudflare refuses is one line with the fix; unreachable or fine passes", async () => {
  const asked: string[] = [];
  const answer = (status: number | null) => async (token: string, account: string) => { asked.push(`${token}@${account}`); return status; };
  const creds = { CLOUDFLARE_API_TOKEN: "bad", CLOUDFLARE_ACCOUNT_ID: "acct1" };
  expect(await cloudflareProblem(creds, answer(400))).toBe(
    "Cloudflare refused the API token for account acct1 (HTTP 400). Run `rustybuns login cloudflare`, or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.");
  expect(asked).toEqual(["bad@acct1"]);
  expect(await cloudflareProblem(creds, answer(200))).toBeNull();
  expect(await cloudflareProblem(creds, answer(null))).toBeNull();
  expect(await cloudflareProblem(creds, answer(503))).toBeNull();
});

test("cloudflareProblem: no credentials is one line; Alchemy's profile, API key or CI env are enough", async () => {
  const never = async () => { throw new Error("no token to check"); };
  const none = () => false;
  expect(await cloudflareProblem({}, never, none)).toBe("not logged in to Cloudflare. Run `rustybuns login cloudflare`, or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.");
  expect(await cloudflareProblem({ CLOUDFLARE_API_TOKEN: "t" }, never, none)).toContain("Alchemy ignores it without CLOUDFLARE_ACCOUNT_ID");
  const seen: string[] = [];
  expect(await cloudflareProblem({ ALCHEMY_HOME: "/h", ALCHEMY_PROFILE: "work" }, never, (p) => { seen.push(p); return true; })).toBeNull();
  expect(seen).toEqual(["/h/profiles/work/cloudflare.json"]);
  expect(alchemyCloudflareProfile({ ALCHEMY_HOME: "/h" })).toBe("/h/profiles/default/cloudflare.json");
  expect(await cloudflareProblem({ CLOUDFLARE_API_KEY: "k", CLOUDFLARE_EMAIL: "e", CLOUDFLARE_ACCOUNT_ID: "a" }, never, none)).toBeNull();
  // no profiles in CI, even one on disk
  expect(await cloudflareProblem({ CI: "true" }, never, () => true)).toContain("no Cloudflare credentials in CI");
  expect(await cloudflareProblem({ CI: "false" }, never, () => true)).toBeNull();
});
