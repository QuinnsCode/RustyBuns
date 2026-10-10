import { test, expect } from "bun:test";
import { BASE_SCOPES, cloudflareEnv, cloudflareScopes, missingScopes, type WhoAmI, type Wrangler } from "../src/cloudflare-auth.ts";
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
