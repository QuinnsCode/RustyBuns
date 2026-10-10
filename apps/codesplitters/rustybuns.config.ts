import { defineConfig } from "@rustybuns/cli/config";

// Accounts, admin and hosted-agent secrets live in 1Password (vault "codesplitters")
// and reach the deploy through varlock: experimental.wheel "human" unlocks them with
// your Touch ID, so there's nothing to export and BETTER_AUTH_SECRET never drifts.
// See .env.schema for the full list. The desktop has none of them: it uses aliases.
//
// Hosted coding agents are opt-in from the deploying shell; their keys come from 1Password too:
//   CODESPLITTERS_AGENTS=1  hosted coding agents (super experimental, see README)
//   CODESPLITTERS_DEPLOYS=1 hosted deploys with each repo's stored deploy key, sealed under
//                           DEPLOY_SECRETS_KEY (1Password, like the rest)
// Account email (verification and password reset) is opt-in the same way, once the
// sender's domain is onboarded to Cloudflare Email Sending (Workers Paid):
//   CODESPLITTERS_MAIL_FROM=accounts@your-domain  binds EMAIL and sends from it
const agents = process.env.CODESPLITTERS_AGENTS === "1";
const deploys = process.env.CODESPLITTERS_DEPLOYS === "1";
const mailFrom = process.env.CODESPLITTERS_MAIL_FROM?.trim();
const op = (ref: string, optional?: true) => ({ type: "secret" as const, op: `op://codesplitters/${ref}`, optional });

export default defineConfig({
  name: "codesplitters",
  experimental: { wheel: "human" },
  worker: {
    main: "src/worker.ts",
    builtMain: "dist/worker/worker.js",
    assets: "dist/client",
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],   // Better Auth leans on Node APIs (AsyncLocalStorage)
    build: "bun run build.ts",
    // Hourly: each repo's dependency doctor runs when its own schedule says it's due (src/deps.ts),
    // and rate limits are swept. Queued requests and webhook retries ride the JOBS and HOOKS queues.
    crons: ["0 * * * *"],
  },
  bindings: {
    // Profiles, repos, playlists and the search index.
    DB: { type: "d1", databaseName: "codesplitters-db", migrationsDir: "migrations" },
    // One Durable Object per file.
    FILES: { type: "durable_object", className: "FileDurableObject" },
    // One game room per level or repo: the lobby on its page, then the relay.
    GAMES: { type: "durable_object", className: "GameRoom" },
    // Webhook tries, one message each; this Worker's queue() sends them and books the
    // retries with a delay (src/hooks.ts). The desktop runs it in-process on sqlite.
    HOOKS: { type: "queue", queueName: "codesplitters-hooks", consumer: { batchSize: 10, maxWaitTimeMs: 1000 } },
    // Queued requests (digs, previews, dependency checks over a limit that queues): one
    // message each, delayed until the caller's window has room (src/limits.ts).
    JOBS: { type: "queue", queueName: "codesplitters-jobs", consumer: { batchSize: 10, maxWaitTimeMs: 1000 } },
    // One git repo per excavation; cataloguing pushes to it.
    ARTIFACTS: { type: "artifacts", namespace: "codesplitters" },
    // Hosted coding agents (super experimental): one container per run, each CLI
    // installed (sandbox/Dockerfile), with the logins for the harnesses you use.
    // The desktop has no twin and runs the CLIs on the machine instead.
    ...(agents ? { AGENT_SANDBOX: { type: "container", className: "AgentSandbox", dockerfile: "sandbox/Dockerfile", maxInstances: 2, instanceType: "basic" } as const } : {}),
    // Optional: only the items you've made in 1Password are bound.
    ...(agents ? {
      ANTHROPIC_API_KEY: op("anthropic/api-key", true),
      CLAUDE_CODE_OAUTH_TOKEN: op("claude-code/oauth-token", true),
      OPENAI_API_KEY: op("openai/api-key", true),
      CODEX_API_KEY: op("codex/api-key", true),
    } : {}),
    // Hosted deploys: one Durable Object per repo, each run in its own container
    // (deploy-sandbox/Dockerfile), separate from the agents' so no agent sees a
    // deploy key. Keys are sealed in D1 under DEPLOY_SECRETS_KEY.
    ...(deploys ? {
      DEPLOY_RUNNER: { type: "container", className: "DeployRunner", dockerfile: "deploy-sandbox/Dockerfile", maxInstances: 1, instanceType: "basic" } as const,
      DEPLOY_SECRETS_KEY: op("DEPLOY_SECRETS_KEY/password"),
      // Only while rotating it: the key before, so what it sealed opens until an admin re-seals (README).
      DEPLOY_SECRETS_KEY_OLD: op("DEPLOY_SECRETS_KEY_OLD/password", true),
    } : {}),
    // Accounts (Better Auth), GitHub and Google sign-in.
    BETTER_AUTH_SECRET: op("better-auth/secret"),
    BETTER_AUTH_URL: { type: "var", value: "https://codesplitters.notryanquinn.workers.dev" },
    GITHUB_CLIENT_ID: op("github-oauth/client-id"),
    GITHUB_CLIENT_SECRET: op("github-oauth/client-secret"),
    GOOGLE_CLIENT_ID: op("google-oauth/client-id"),
    GOOGLE_CLIENT_SECRET: op("google-oauth/client-secret"),
    // Handles allowed to excavate levels once accounts are on. "quinn" is short,
    // so nobody can pick it; it goes to whoever signs in with ADMIN_EMAIL, verified.
    ADMINS: { type: "var", value: "quinn" },
    ADMIN_EMAIL: op("admin/email"),
    // Verification and reset links for email accounts (src/identity.ts).
    ...(mailFrom ? {
      EMAIL: { type: "send_email", allowedSenderAddresses: [mailFrom] } as const,
      EMAIL_FROM: { type: "var", value: mailFrom } as const,
    } : {}),
  },
  targets: {
    // Live as Worker codesplitters + D1 codesplitters-db, first deployed with wrangler;
    // adopted by rustybuns deploy on 2026-10-09 (#170). Keep adopt on: a new clone or stage
    // starts with empty state, and adopt takes these over instead of duplicating them.
    // D1 migrations are Alchemy's (__alchemy_migrations); never apply them with wrangler (README).
    edge: { provider: "cloudflare", adopt: true },
    desktop: { mode: "worker", window: "app" },
  },
});
