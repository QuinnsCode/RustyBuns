import { expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dropSecrets, secretName } from "../live/env.ts";
import { unpackPinned } from "./pinned.ts";

setDefaultTimeout(60_000);

test("secret-shaped names are secrets; the everyday ones aren't", () => {
  for (const n of ["CLOUDFLARE_API_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "OP_SERVICE_ACCOUNT_TOKEN", "OP_SESSION_my", "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN", "GEMINI_API_KEY", "STRIPE_SECRET", "PGPASSWORD", "DB_PASSWD", "CLIENT_SECRETS", "NPM_TOKEN", "TOKEN", "MY_APIKEY",
    "GH_PAT", "TOKEN_GITHUB", "AWS_ACCESS_KEY_ID", "GOOGLE_APPLICATION_CREDENTIALS", "DATABASE_URL", "REDIS_URL", "SENTRY_DSN", "SLACK_WEBHOOK_URL",
    "DISCORD_WEBHOOK", "SSH_AUTH_SOCK", "DB_PASS", "SMTP_PWD", "GPG_PASSPHRASE", "RB_JOIN", "CF_AUTH", "APP_JWT", "ADMIN_COOKIE", "KUBECONFIG", "npm_config_//registry.npmjs.org/:_authToken"])
    expect(secretName(n)).toBe(true);
  for (const n of ["PATH", "HOME", "SHELL", "LANG", "TERM", "TMPDIR", "XDG_CACHE_HOME", "KEYCHAIN_PATH", "NVM_DIR", "TOKENIZERS_PARALLELISM", "EDITOR",
    "SESSION_MANAGER", "COLORTERM", "AUTHOR", "PASSENGER", "KEYBOARD", "MISSION", "USER", "PWD", "OLDPWD", "LOGNAME"])
    expect(secretName(n)).toBe(false);
});

test("dropSecrets keeps the agents' own auth and the names AGENT_OFFICE_ENV_PASS lets through", () => {
  const env: Record<string, string> = { PATH: "/bin", HOME: "/h", GH_TOKEN: "g", CLOUDFLARE_API_TOKEN: "c", ANTHROPIC_API_KEY: "a", CLAUDE_CODE_OAUTH_TOKEN: "o", NPM_TOKEN: "n" };
  const { dropped } = dropSecrets(env, { AGENT_OFFICE_ENV_PASS: " NPM_TOKEN ,," });
  expect(env).toEqual({ PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "a", CLAUDE_CODE_OAUTH_TOKEN: "o", NPM_TOKEN: "n" });
  expect(dropped.sort()).toEqual(["CLOUDFLARE_API_TOKEN", "GH_TOKEN"]);
});

test("the pinned release's childEnv, patched, hands workers no secrets", async () => {
  const srv = path.join(await unpackPinned(), "dist/server/server");
  const file = path.join(srv, "workers/env.js");
  const anchor = "            env[k] = v;\n    return env;\n}";
  const src = readFileSync(file, "utf8");
  expect(src.split(anchor)).toHaveLength(2);
  const script = readFileSync(path.join(import.meta.dir, "../scripts/rustybunsify.ts"), "utf8");
  expect(script).toContain(JSON.stringify(anchor).slice(1, -1));

  // the same patch rustybunsify makes, with rb-env.js built beside it
  const built = await Bun.build({ entrypoints: [path.join(import.meta.dir, "../live/env.ts")], target: "bun" });
  await Bun.write(path.join(srv, "rb-env.js"), built.outputs[0]!);
  writeFileSync(file, "import { workerEnv as __rbWorkerEnv } from '../rb-env.js';\n" + src.replace(anchor, anchor.replace("return env;", "return __rbWorkerEnv(env);")));
  const probe = path.join(srv, "probe.js");
  writeFileSync(probe, "import { childEnv } from './workers/env.js';\nconsole.log(JSON.stringify(childEnv()));\n");
  const run = Bun.spawnSync(["bun", probe], {
    env: { PATH: process.env.PATH, HOME: "/h", GH_TOKEN: "g", OP_SERVICE_ACCOUNT_TOKEN: "op", ANTHROPIC_API_KEY: "a", AGENT_OFFICE_ENV_PASS: "NPM_TOKEN", NPM_TOKEN: "n" },
  });
  const out = run.stdout.toString().trim().split("\n");
  const child = JSON.parse(out.at(-1)!);
  expect(child).toMatchObject({ HOME: "/h", ANTHROPIC_API_KEY: "a", NPM_TOKEN: "n" });
  for (const k of ["GH_TOKEN", "OP_SERVICE_ACCOUNT_TOKEN", "AGENT_OFFICE_ENV_PASS"]) expect(child[k]).toBeUndefined();
  expect(out[0]).toBe("[env] kept from the workers: GH_TOKEN, OP_SERVICE_ACCOUNT_TOKEN (AGENT_OFFICE_ENV_PASS=NAME,... lets one through)");
});
