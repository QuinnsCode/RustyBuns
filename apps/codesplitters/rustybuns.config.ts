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
//   CODESPLITTERS_CHECKS=1  queued checks run in a container per run (CiRunner, src/ci-runner.ts);
//                           billed by use, see REFERENCE.md. No secrets go in.
//   CODESPLITTERS_VECTORS=1 search across repos through one Vectorize index, embedded with
//                           Workers AI (src/search.ts); billed by use, see REFERENCE.md
//   CODESPLITTERS_WATCH_NEWS=1 the supply-chain watch's daily news search for compromised
//                           packages (src/watch.ts): one Claude run with web search a day,
//                           on ANTHROPIC_API_KEY; billed by use, see REFERENCE.md
// Account email (verification and password reset) is opt-in the same way, once the
// sender's domain is onboarded to Cloudflare Email Sending (Workers Paid):
//   CODESPLITTERS_MAIL_FROM=accounts@your-domain  binds EMAIL and sends from it
const agents = process.env.CODESPLITTERS_AGENTS === "1";
const deploys = process.env.CODESPLITTERS_DEPLOYS === "1";
const vectors = process.env.CODESPLITTERS_VECTORS === "1";
const checks = process.env.CODESPLITTERS_CHECKS === "1";
const news = process.env.CODESPLITTERS_WATCH_NEWS === "1";
const mailFrom = process.env.CODESPLITTERS_MAIL_FROM?.trim();
// A change to the privacy page that matters goes here first, as "YYYY-MM-DD what changes"
// (the day it applies), and ships before that day: the site shows it as a banner (src/privacy.ts).
// Empty means no banner.
const privacyNotice = "";
// Cloudflare Turnstile's site key (public) for the widget on sign-up, password reset and joining a
// crew (src/security.ts). Set it once the widget exists for this hostname; its secret is then
// required from 1Password (codesplitters/turnstile/secret). Empty means no bot check.
const turnstileSiteKey = "0x4AAAAAAFTyaxcLpAqRT0pg";
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
    // Every 5 minutes: mirrors sync with upstream (src/mirror.ts). They're desktop only, so on
    // Cloudflare it returns at once without touching D1.
    crons: ["0 * * * *", "*/5 * * * *"],
    // A dig over Artifacts' 40 MB import cap rebuilds the repo from GitHub's tarball inside the
    // request (src/tarball.ts); level imports do the same off the LEVEL_DIGS queue. Measured live
    // (#348): Alchemy's dig took 9.9 s of CPU, and Bun's level import to R2 8.9 s. That's under
    // the default 30 s, but a bigger repo has room to grow. This is a cap, billed per ms used.
    cpuMs: 300_000,
    // Smart Placement (#611): most requests make several round trips to codesplitters-db and the
    // file Durable Objects, so the Worker runs near those instead of near the visitor.
    placement: { mode: "smart" },
    // Workers Logs drop each URL's query string (OAuth codes, ?confirm= handles), as #/privacy
    // says. Each upload resets it, so rustybuns deploy sets it again after (#553).
    redactQueryStrings: true,
    // build.ts minifies the Worker; its source map goes up with it so traces still read (#612).
    sourceMaps: true,
  },
  bindings: {
    // Profiles, repos, playlists and the search index.
    DB: { type: "d1", databaseName: "codesplitters-db", migrationsDir: "migrations" },
    // One Durable Object per file.
    FILES: { type: "durable_object", className: "FileDurableObject" },
    // One game room per level or repo: the lobby on its page, then the relay.
    GAMES: { type: "durable_object", className: "GameRoom" },
    // One code search index per repo, FTS5 in its SQLite (src/search.ts).
    SEARCH: { type: "durable_object", className: "RepoSearch" },
    // Search across repos: one vector index over every repo's committed code, and Workers AI
    // (bge-small-en-v1.5, 384 dimensions) to embed it. Without them, it fans out (src/search.ts).
    ...(vectors ? {
      VECTORS: { type: "vectorize", indexName: "codesplitters-vectors", dimensions: 384, metadataIndexes: { repo: "string", pub: "boolean" } } as const,
      AI: { type: "ai" } as const,
    } : {}),
    // Webhook tries, one message each; this Worker's queue() sends them and books the
    // retries with a delay (src/hooks.ts). The desktop runs it in-process on sqlite.
    HOOKS: { type: "queue", queueName: "codesplitters-hooks", consumer: { batchSize: 10, maxWaitTimeMs: 1000 } },
    // Queued requests (digs, previews, dependency checks over a limit that queues): one
    // message each, delayed until the caller's window has room (src/limits.ts).
    JOBS: { type: "queue", queueName: "codesplitters-jobs", consumer: { batchSize: 10, maxWaitTimeMs: 1000 } },
    // Level digs: an import's first step, then a big level's parts (src/swarm.ts), one
    // message each, several at once. maxConcurrency caps how hard GitHub gets hit.
    LEVEL_DIGS: { type: "queue", queueName: "codesplitters-level-digs", consumer: { batchSize: 1, maxWaitTimeMs: 1000, maxRetries: 3, retryDelay: 20, maxConcurrency: 8 } },
    // One git repo per excavation; cataloguing pushes to it.
    ARTIFACTS: { type: "artifacts", namespace: "codesplitters" },
    // Levels too big for an Artifacts repo even from the tarball, as ~8 MB chunks of their text files
    // (src/chunks.ts), read through the Cache API. None so far: Bun and Alchemy fit in Artifacts
    // from the tarball (#356), so the bucket is empty. No desktop twin yet; the desktop's local
    // git takes any size anyway.
    LEVEL_CHUNKS: { type: "r2", bucketName: "codesplitters-level-chunks" },
    // Hosted coding agents (super experimental): one container per run, each CLI
    // installed (sandbox/Dockerfile), with the logins for the harnesses you use.
    // The desktop has no twin and runs the CLIs on the machine instead.
    ...(agents ? { AGENT_SANDBOX: { type: "container", className: "AgentSandbox", dockerfile: "sandbox/Dockerfile", maxInstances: 2, instanceType: "basic" } as const } : {}),
    // The watch's news search: on, with the Anthropic key (also the agents' when they're on).
    ...(news ? { WATCH_NEWS: { type: "var", value: "1" } as const, ANTHROPIC_API_KEY: op("anthropic/api-key", true) } : {}),
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
    // Checks in containers: one Durable Object per repo, so one run at a time, each in its own
    // container (deploy-sandbox/ci.Dockerfile: git, bun and the deploy image's small server),
    // with no secrets at all. Two at once across the site caps the spend.
    ...(checks ? { CI_RUNNER: { type: "container", className: "CiRunner", dockerfile: "deploy-sandbox/ci.Dockerfile", maxInstances: 2, instanceType: "basic" } as const } : {}),
    // Accounts (Better Auth), GitHub and Google sign-in.
    BETTER_AUTH_SECRET: op("better-auth/secret"),
    BETTER_AUTH_URL: { type: "var", value: "https://codesplitter.notryanquinn.workers.dev" },
    GITHUB_CLIENT_ID: op("github-oauth/client-id"),
    GITHUB_CLIENT_SECRET: op("github-oauth/client-secret"),
    GOOGLE_CLIENT_ID: op("google-oauth/client-id"),
    GOOGLE_CLIENT_SECRET: op("google-oauth/client-secret"),
    // Handles allowed to excavate levels once accounts are on. "quinn" is short,
    // so nobody can pick it; it goes to whoever signs in with ADMIN_EMAIL, verified.
    ADMINS: { type: "var", value: "quinn" },
    ADMIN_EMAIL: op("admin/email"),
    // Where privacy requests go, shown on #/privacy (src/privacy.ts). Optional: without it the page offers the export and delete buttons only.
    PRIVACY_EMAIL: op("privacy/email", true),
    ...(privacyNotice ? { PRIVACY_NOTICE: { type: "var", value: privacyNotice } as const } : {}),
    // Bursts of sign-ins, sign-ups and account mail are turned away at the edge, in memory,
    // before D1's counters write a row (src/security.ts). Free; the namespace is any id unique in the account.
    AUTH_LIMIT: { type: "ratelimit", namespaceId: "6470", simple: { limit: 20, period: 60 } },
    ...(turnstileSiteKey ? {
      TURNSTILE_SITE_KEY: { type: "var", value: turnstileSiteKey } as const,
      TURNSTILE_SECRET: op("turnstile/secret"),
    } : {}),
    // Verification and reset links for email accounts (src/identity.ts).
    ...(mailFrom ? {
      EMAIL: { type: "send_email", allowedSenderAddresses: [mailFrom] } as const,
      EMAIL_FROM: { type: "var", value: mailFrom } as const,
    } : {}),
  },
  targets: {
    // Live as D1 codesplitters-db, first deployed with wrangler; adopted by rustybuns deploy on
    // 2026-10-09 (#170). Keep adopt on: a new clone or stage starts with empty state, and adopt
    // takes these over instead of duplicating them. The app (and its Alchemy state) keeps the
    // name codesplitters; the Worker was renamed to codesplitter on 2026-10-11, and renamedFrom
    // moved its files, game rooms and search over with their data. The containers started empty.
    // D1 migrations are Alchemy's (__alchemy_migrations); never apply them with wrangler (README).
    edge: { provider: "cloudflare", adopt: true, workerName: "codesplitter", renamedFrom: "codesplitters" },
    desktop: { mode: "worker", window: "app" },
  },
});
