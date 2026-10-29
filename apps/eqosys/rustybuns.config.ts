import { defineConfig } from "@rustybuns/cli/config";

// eqosys: one account for every Q app, games and suite alike. One Worker, one D1 database: Better Auth's
// accounts, where each person came from, which apps they use and what they may do there (src/members.ts).
// Apps send people to /login and trade the code that comes back at /api/exchange (src/handle.ts).
//
// Secrets (see .env.schema): BETTER_AUTH_SECRET signs sessions; SUPER_ADMIN_EMAIL is the one account that
// sees everyone and grants access; EQOSYS_SIGNING_KEY signs the tokens apps check on their own. GitHub and Google sign-in turn on once both halves of a provider are set.
export default defineConfig({
  name: "eqosys",
  worker: {
    main: "src/worker.tsx",
    builtMain: "dist/worker/index.js",
    assets: "dist/client",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    build: "bun run build",
  },
  bindings: {
    DB: { type: "d1", databaseName: "eqosys-db", protect: true, migrationsDir: "migrations" },
    // One hub a person (src/hub.ts): friends, who is on in which app, notifications. Hibernating sockets, no alarms.
    HUB: { type: "durable_object", className: "Hub" },
    // Sign-in attempts: 20 a minute per IP, counted by Cloudflare rather than in each isolate.
    AUTH_LIMIT: { type: "ratelimit", namespaceId: "8203", simple: { limit: 20, period: 60 } },
    BETTER_AUTH_SECRET: { type: "secret", op: "op://eqosys/better-auth/password" },
    BETTER_AUTH_URL: { type: "var", value: "https://eqosys.qntbr.com" },
    SUPER_ADMIN_EMAIL: { type: "secret", op: "op://eqosys/admin/password", optional: true },
    // Signs the tokens apps check against /.well-known/jwks.json; `bun scripts/keygen.ts` makes one. No key, no token.
    EQOSYS_SIGNING_KEY: { type: "secret", op: "op://eqosys/signing-key/password", optional: true },
    GITHUB_CLIENT_ID: { type: "secret", op: "op://eqosys/github/client-id", optional: true },
    GITHUB_CLIENT_SECRET: { type: "secret", op: "op://eqosys/github/client-secret", optional: true },
    GOOGLE_CLIENT_ID: { type: "secret", op: "op://eqosys/google/client-id", optional: true },
    GOOGLE_CLIENT_SECRET: { type: "secret", op: "op://eqosys/google/client-secret", optional: true },
  },
  experimental: { wheel: "human" },
  targets: { edge: { provider: "cloudflare" } },
});
