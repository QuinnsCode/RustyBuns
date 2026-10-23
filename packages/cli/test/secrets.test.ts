import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeSecrets, wranglerNames } from "../src/glue/secrets.ts";

test("codeSecrets: names src/ reads that nothing declares; rwsdk's session store needs AUTH_SECRET_KEY", () => {
  const src = mkdtempSync(join(tmpdir(), "rb-secrets-"));
  mkdirSync(join(src, "app/auth"), { recursive: true });
  mkdirSync(join(src, "e2e"), { recursive: true });
  writeFileSync(join(src, "app/auth/store.ts"), 'import { defineDurableSession } from "rwsdk/auth";\nconst k = env.O365_OAUTH_CLIENT_SECRET, d = env.DB, v = env["APP_URL"], m = import.meta.env.VITE_X;\n');
  writeFileSync(join(src, "app/mail.ts"), "send(env.EMAIL, process.env.NODE_ENV, env.X, env.LOADER);\n");
  writeFileSync(join(src, "app/mail.test.ts"), "env.TEST_ONLY_TOKEN;\n");
  writeFileSync(join(src, "e2e/login.ts"), "env.E2E_PASSWORD;\n");
  const known = new Set(["DB", "APP_URL", "EMAIL", ...wranglerNames({ worker_loaders: [{ binding: "LOADER" }] })]);
  expect(codeSecrets(src, known, "rwsdk")).toEqual({ required: ["AUTH_SECRET_KEY"], optional: ["O365_OAUTH_CLIENT_SECRET"], inferred: {} });
  // only rwsdk's own session store reads AUTH_SECRET_KEY
  expect(codeSecrets(src, known, "vite").required).toEqual([]);
});

test("codeSecrets: env.X.run( is an ai binding and env.X_R2.put( an r2 one, not secrets", () => {
  const src = mkdtempSync(join(tmpdir(), "rb-secrets-"));
  writeFileSync(join(src, "api.ts"), "await env.AI.run(m, p); await env.ANALYTICS_R2.put(k, v); env.MOCK_FLAG; env.TOKEN.get(1);\n");
  const r = codeSecrets(src, new Set());
  expect(r.inferred).toEqual({ AI: "ai", ANALYTICS_R2: "r2" });
  expect(r.optional).toEqual(["MOCK_FLAG", "TOKEN"]);
});

test("wranglerNames: every binding, var and secret, env blocks and unsupported kinds included", () => {
  expect(wranglerNames({
    name: "app",
    vars: { APP_URL: "x" },
    secrets: { required: ["API_KEY"] },
    workflows: [{ name: "flow", binding: "FLOW", class_name: "Flow" }],
    vectorize: [{ binding: "INDEX", index_name: "i" }],
    env: { dev: { vars: { DEV_ONLY: "1" }, worker_loaders: [{ binding: "LOADER" }] } },
  }).sort()).toEqual(["API_KEY", "APP_URL", "DEV_ONLY", "FLOW", "INDEX", "LOADER", "app", "flow"]);
});
