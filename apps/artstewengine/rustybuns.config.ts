import { defineConfig } from "@rustybuns/cli/config";

// artstewengine: the pay-me check. qCRM's sealed engine asks it "have you paid?" (POST /lease); the owner
// signs in to a small admin page to add and revoke paid licenses. One Worker, one D1 (Better Auth's
// admin account, the licenses, an hourly tally). Apart from qCRM on purpose: cutting a license off
// never needs a change to code the licensee holds.
//
// Secrets (see .env.schema): BETTER_AUTH_SECRET signs the admin session; ADMIN_EMAIL is the one account
// allowed to exist; ENGINE_KEY is what a paid license is handed. All resolve through varlock.
export default defineConfig({
  name: "artstewengine",
  worker: {
    main: "src/worker.tsx",
    builtMain: "dist/worker/index.js",
    assets: "dist/client",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    build: "bun run build",
  },
  bindings: {
    DB: { type: "d1", databaseName: "artstewengine-db", protect: true, migrationsDir: "migrations" },
    // Sign-in attempts: 10 a minute per IP, counted by Cloudflare rather than in each isolate.
    AUTH_LIMIT: { type: "ratelimit", namespaceId: "8202", simple: { limit: 10, period: 60 } },
    BETTER_AUTH_SECRET: { type: "secret", op: "op://qcrm/engine/auth-secret" },
    BETTER_AUTH_URL: { type: "var", value: "https://artstewengine.qntbr.com" },
    ADMIN_EMAIL: { type: "secret", op: "op://qcrm/engine/admin-email" },
    ENGINE_KEY: { type: "secret", op: "op://qcrm/engine/key" },
  },
  experimental: { wheel: "human" },
  targets: { edge: { provider: "cloudflare" } },
});
