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
    // Qollab (apps/qollab, QOLLAB.md) hosts these three since #3816; eqosys's pages, account delete and privacy export still call them.
    // One hub a person (src/qollab/hub.ts): friends, who is on in which app, notifications. Hibernating sockets, no alarms.
    HUB: { type: "durable_object", className: "Hub", app: "qollab" },
    // One party a room code (src/qollab/party.ts): the lobby a game's players meet in. Hibernating sockets, no alarms.
    PARTY: { type: "durable_object", className: "Party", app: "qollab" },
    // One space a space id (src/qollab/space.ts): its text channels and their history. Hibernating sockets, no alarms.
    SPACE: { type: "durable_object", className: "Space", app: "qollab" },
    // Qollab's Worker: every Qollab path (/hub, /api/hub, /q/party, /q/space, /q/save, /q/qlave/roster) is handed to it.
    QOLLAB: { type: "service", app: "qollab" },
    // One vault a person (src/vault.ts, src/privacy.ts): the key their saves are sealed with, consents and requests. Made in the EU
    // jurisdiction (VAULT.jurisdiction("eu")) for anyone whose first sign-in came from Europe. No sockets, no alarms.
    VAULT: { type: "durable_object", className: "Vault" },
    // Sign-in attempts: 20 a minute per IP, counted by Cloudflare rather than in each isolate.
    AUTH_LIMIT: { type: "ratelimit", namespaceId: "8203", simple: { limit: 20, period: 60 } },
    // Reports from the games (src/reports.ts): 5 a minute per IP here, then 5 an hour and 20 a day per account in D1.
    // GITHUB_REPORT_TOKEN (a fine-grained token, issues:write on RustyBuns only) is added as a secret binding together with
    // its 1Password item `eqosys/github-report`; until then /api/report answers 503.
    REPORT_LIMIT: { type: "ratelimit", namespaceId: "8204", simple: { limit: 5, period: 60 } },
    // Where eq_execute programs run (src/codemode.ts): a Worker with no network that calls the tools through a bridge.
    LOADER: { type: "worker_loader" },
    BETTER_AUTH_SECRET: { type: "secret", op: "op://eqosys/better-auth/password" },
    BETTER_AUTH_URL: { type: "var", value: "https://eqosys.qntbr.com" },
    SUPER_ADMIN_EMAIL: { type: "secret", op: "op://eqosys/admin/password", optional: true },
    // Signs the tokens apps check against /.well-known/jwks.json; `bun scripts/keygen.ts` makes one. No key, no token.
    EQOSYS_SIGNING_KEY: { type: "secret", op: "op://eqosys/signing-key/password", optional: true },
  },
  experimental: { wheel: "human" },
  // Its own name; every other *.qntbr.com name stays with the wildcard route in front of qntbr.com.
  targets: { edge: { provider: "cloudflare", domain: "eqosys.qntbr.com" } },
  // `--stage preview`: a whole second eqosys on its own name and its own empty database, for trying a change (Qollab's move,
  // #3816) before production. Deploy apps/qollab with the same stage first: each stage's Qollab binds that stage's eqosys.
  stages: {
    preview: {
      domain: "eqosys-preview.qntbr.com",
      bindings: { DB: { databaseName: "eqosys-preview-db", protect: false }, BETTER_AUTH_URL: { value: "https://eqosys-preview.qntbr.com" } },
    },
  },
});
