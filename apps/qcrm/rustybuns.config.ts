import { defineConfig } from "@rustybuns/cli/config";

// qCRM: one Worker, one D1 database per deployment, a queue for webhook deliveries.
// Every org's rows carry its id (a hash of the owner's account id, src/orgs.ts), so one
// database serves every org and no query runs without an org in its WHERE.
//
// Secrets (see .env.schema): BETTER_AUTH_SECRET signs sessions and salts org ids;
// SUPER_ADMIN_EMAIL names the one account above every org. Both resolve through varlock.
export default defineConfig({
  name: "qcrm",
  worker: {
    main: "src/worker.tsx",
    builtMain: "dist/worker/index.js",
    assets: "dist/client",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    build: "bun run build",
    desktopOpenPaths: ["/api/mcp"],
    // Hourly: webhook retries that fell out of the queue window, and stale sync cursors.
    crons: ["0 * * * *"],
  },
  bindings: {
    // Accounts, orgs, memberships, contacts, companies, deals, activities, webhooks, the change log.
    DB: { type: "d1", databaseName: "qcrm-db", protect: true, migrationsDir: "migrations" },
    // Webhook deliveries, one message each, retried with a delay (src/webhooks.ts).
    // Stored scripts run in a dynamic Worker of their own, no network, one service binding back to the API (src/scripts.ts).
    LOADER: { type: "worker_loader" },
    HOOKS: { type: "queue", queueName: "qcrm-hooks", consumer: { batchSize: 10, maxWaitTimeMs: 1000 } },
    BETTER_AUTH_SECRET: { type: "secret", op: "op://qcrm/better-auth/secret" },
    BETTER_AUTH_URL: { type: "var", value: "https://qcrm.qntbr.com" },
    // Optional social sign-in: a button shows once both halves of a provider are set (src/auth.ts).
    GITHUB_CLIENT_ID: { type: "secret", op: "op://qcrm/github/client-id", optional: true },
    GITHUB_CLIENT_SECRET: { type: "secret", op: "op://qcrm/github/client-secret", optional: true },
    GOOGLE_CLIENT_ID: { type: "secret", op: "op://qcrm/google/client-id", optional: true },
    GOOGLE_CLIENT_SECRET: { type: "secret", op: "op://qcrm/google/client-secret", optional: true },
    // Optional: without it there is no super admin, and the first org owner is on their own.
    SUPER_ADMIN_EMAIL: { type: "secret", op: "op://qcrm/admin/email", optional: true },
  },
  experimental: { wheel: "human" },
  targets: {
    edge: { provider: "cloudflare" },
    // The desktop app: the same Worker on Bun with sqlite for D1 and an in-process queue, data in ~/.qcrm.
    desktop: { mode: "worker", window: "app", dataDir: "~/.qcrm" },
  },
});
