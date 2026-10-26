import { defineConfig } from "@rustybuns/cli/config";
import { CRATES, GITHUB_HOSTS, HARNESS_HOSTS, PROVIDER_HOSTS, REGISTRIES, hostList } from "./src/egress.ts";

// What `rustybuns containers run --prod-like` gates each container with: the gate's own module, and the
// hosts that container may reach in production (the lists egress.ts builds a run's from).
const egress = (...hosts: (readonly string[])[]) => ({ module: "src/egress.ts", hosts: hostList(...hosts) });

// Accounts, admin and hosted-agent secrets live in 1Password (vault "codesplitter")
// and reach the deploy through varlock: experimental.wheel "human" unlocks them with
// your Touch ID, so there's nothing to export and BETTER_AUTH_SECRET never drifts.
// See .env.schema for the full list. The desktop has none of them: it uses aliases.
//
// Hosted coding agents are opt-in from the deploying shell; their keys come from 1Password too:
//   CODESPLITTER_AGENTS=1  hosted coding agents (super experimental, see README)
//   CODESPLITTER_DEPLOYS=1 hosted deploys with each repo's stored deploy key, sealed under
//                          DEPLOY_SECRETS_KEY (1Password, like the rest)
//   CODESPLITTER_CHECKS=1  queued checks run in a container per run (CiRunner, src/ci-runner.ts);
//                          billed by use, see REFERENCE.md. No secrets go in.
//   CODESPLITTER_VECTORS=1 search across repos through one Vectorize index, embedded with
//                          Workers AI (src/search.ts); billed by use, see REFERENCE.md
//   CODESPLITTER_PUSH_EVENTS=1 a queue that hears Artifacts' push events and logs pushes made
//                          outside the app (src/push-events.ts); its subscription is made by hand, below
//   CODESPLITTER_WATCH_NEWS=1 the supply-chain watch's daily news search for compromised
//                          packages (src/watch.ts): one Claude run with web search a day,
//                          on ANTHROPIC_API_KEY; billed by use, see REFERENCE.md
// Account email (verification and password reset) is opt-in the same way, once the
// sender's domain is onboarded to Cloudflare Email Sending (Workers Paid):
//   CODESPLITTER_MAIL_FROM=accounts@your-domain  binds EMAIL and sends from it
const flag = (name: string) => process.env[`CODESPLITTER_${name}`];
const agents = flag("AGENTS") === "1";
const deploys = flag("DEPLOYS") === "1";
const vectors = flag("VECTORS") === "1";
const checks = flag("CHECKS") === "1";
const news = flag("WATCH_NEWS") === "1";
const pushEvents = flag("PUSH_EVENTS") === "1";
const mailFrom = flag("MAIL_FROM")?.trim();
// A change to the privacy page that matters goes here first, as "YYYY-MM-DD what changes"
// (the day it applies), and ships before that day: the site shows it as a banner (src/privacy.ts).
// Empty means no banner.
const privacyNotice = "";
// Cloudflare Turnstile's site key (public) for the widget on sign-up, password reset and joining a
// crew (src/security.ts). Set it once the widget exists for this hostname; its secret is then
// required from 1Password (codesplitter/turnstile/secret). Empty means no bot check.
const turnstileSiteKey = "0x4AAAAAAFTyaxcLpAqRT0pg";
const op = (ref: string, optional?: true) => ({ type: "secret" as const, op: `op://codesplitter/${ref}`, optional });

// Everything below was named codesplitters until #809. On Cloudflare the names moved together,
// their data copied first by scripts/move-resources.ts (a deploy that renames one without
// --allow-delete is refused). renamedFrom has the desktop pick its old database and queued
// messages up under the new names.
export default defineConfig({
  name: "codesplitter",
  experimental: { wheel: "human" },
  worker: {
    main: "src/worker.ts",
    builtMain: "dist/worker/worker.js",
    assets: "dist/client",
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],   // Better Auth leans on Node APIs (AsyncLocalStorage)
    build: "bun run build.ts",
    // An MCP client (Claude Code) has no host cookie; /api/mcp, the OAuth routes and their
    // discovery documents carry their own auth (tokens, the consent page's session), as on the edge.
    desktopOpenPaths: ["/api/mcp", "/api/oauth/", "/.well-known/oauth-"],
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
    // Smart Placement (#611): most requests make several round trips to codesplitter-db and the
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
    DB: { type: "d1", databaseName: "codesplitter-db", protect: true, renamedFrom: "codesplitters-db", migrationsDir: "migrations" },
    // One Durable Object per file.
    FILES: { type: "durable_object", className: "FileDurableObject" },
    // One game room per level or repo: the lobby on its page, then the relay.
    GAMES: { type: "durable_object", className: "GameRoom" },
    // One code search index per repo, FTS5 in its SQLite (src/search.ts).
    SEARCH: { type: "durable_object", className: "RepoSearch" },
    // One settings object per person, created near where they first connect (src/settings.ts).
    SETTINGS: { type: "durable_object", className: "UserSettings" },
    // Search across repos: one vector index over every repo's committed code, and Workers AI
    // (bge-small-en-v1.5, 384 dimensions) to embed it. Without them, it fans out (src/search.ts).
    ...(vectors ? {
      VECTORS: { type: "vectorize", indexName: "codesplitter-vectors", protect: true, dimensions: 384, metadataIndexes: { repo: "string", pub: "boolean" } } as const,
      AI: { type: "ai" } as const,
    } : {}),
    // The landing page's counts (merges, clashes Mervin settled), copied here for a minute so a visit costs a KV read, not D1 (src/stats.ts).
    STATS: { type: "kv", protect: true },
    // Webhook tries, one message each; this Worker's queue() sends them and books the
    // retries with a delay (src/hooks.ts). The desktop runs it in-process on sqlite.
    HOOKS: { type: "queue", queueName: "codesplitter-hooks", renamedFrom: "codesplitters-hooks", consumer: { batchSize: 10, maxWaitTimeMs: 1000 } },
    // Queued requests (digs, previews, dependency checks over a limit that queues): one
    // message each, delayed until the caller's window has room (src/limits.ts).
    JOBS: { type: "queue", queueName: "codesplitter-jobs", renamedFrom: "codesplitters-jobs", consumer: { batchSize: 10, maxWaitTimeMs: 1000 } },
    // Fix tasks (src/heal.ts: a failing check, a merge guard, a rebuild on main), one message
    // each, in a queue of their own so they don't wait behind feature runs on JOBS (#1234).
    FIXES: { type: "queue", queueName: "codesplitter-fixes", consumer: { batchSize: 1, maxWaitTimeMs: 1000 } },
    // Level digs: an import's first step, then a big level's parts (src/swarm.ts), one
    // message each, several at once. maxConcurrency caps how hard GitHub gets hit.
    LEVEL_DIGS: { type: "queue", queueName: "codesplitter-level-digs", renamedFrom: "codesplitters-level-digs", consumer: { batchSize: 1, maxWaitTimeMs: 1000, maxRetries: 3, retryDelay: 20, maxConcurrency: 8 } },
    // Artifacts' events about its repos (src/push-events.ts): a push from outside the app goes in the
    // repo's audit log. The deploy makes the queue; the subscription that fills it is made once by hand:
    //   wrangler queues subscription create codesplitter-artifact-events --source artifacts.repo --events pushed ...
    ...(pushEvents ? { ARTIFACT_EVENTS: { type: "queue", queueName: "codesplitter-artifact-events", consumer: { batchSize: 10, maxWaitTimeMs: 1000 } } as const } : {}),
    // One git repo per excavation; cataloguing pushes to it.
    // Still the old name: each repo's remote, stored in D1, names it, so it moves on its own (#823).
    ARTIFACTS: { type: "artifacts", namespace: "codesplitters" },
    // Where they move to (src/artifact-move.ts): copy into it, switch ARTIFACTS to "codesplitter", drop this.
    ARTIFACTS_NEXT: { type: "artifacts", namespace: "codesplitter" },
    // EU storage (#2301): once the namespace exists (REST only: POST /accounts/:id/artifacts/namespaces {namespace, jurisdiction: "eu"}),
    // bind it here as ARTIFACTS_EU and repos made with region "eu" keep their git in it. Unbound, "eu" is refused.
    // Levels too big for an Artifacts repo even from the tarball, as ~8 MB chunks of their text files
    // (src/chunks.ts), read through the Cache API. None so far: Bun and Alchemy fit in Artifacts
    // from the tarball (#356), so the bucket is empty. No desktop twin yet; the desktop's local
    // git takes any size anyway.
    LEVEL_CHUNKS: { type: "r2", bucketName: "codesplitter-level-chunks", protect: true },
    // Code mode (src/codemode.ts): an agent's program over the MCP tools runs in a dynamic Worker of its own, with no network and the tools as its only reach.
    LOADER: { type: "worker_loader" },
    // Hosted coding agents (super experimental): one container per run, each CLI
    // installed (sandbox/Dockerfile), with the logins for the harnesses you use.
    // The desktop has no twin and runs the CLIs on the machine instead.
    ...(agents ? { AGENT_SANDBOX: { type: "container", className: "AgentSandbox", dockerfile: "sandbox/Dockerfile", maxInstances: 2, instanceType: "basic", egress: egress(REGISTRIES, GITHUB_HOSTS, ...Object.values(HARNESS_HOSTS)) } as const } : {}),
    // The watch's news search: on, with the Anthropic key (also the agents' when they're on).
    ...(news ? { WATCH_NEWS: { type: "var", value: "1" } as const, ANTHROPIC_API_KEY: op("anthropic/api-key", true) } : {}),
    // Optional: only the items you've made in 1Password are bound.
    ...(agents ? {
      ANTHROPIC_API_KEY: op("anthropic/api-key", true),
      OPENAI_API_KEY: op("openai/api-key", true),
      CODEX_API_KEY: op("codex/api-key", true),
    } : {}),
    // The watchdog Worker's shared secret (watchdog/README.md): optional, the rollback report is off without it.
    WATCHDOG_SECRET: op("WATCHDOG_SECRET/password", true),
    // The deploy's call to warn busy rooms (rustybuns deploy --drain-url, src/drain.ts): optional, the route is off without it.
    DRAIN_SECRET: op("DRAIN_SECRET/password", true),
    // Hosted deploys: one Durable Object per repo, each run in its own container
    // (deploy-sandbox/Dockerfile), separate from the agents' so no agent sees a
    // deploy key. Keys are sealed in D1 under DEPLOY_SECRETS_KEY.
    ...(deploys ? {
      DEPLOY_RUNNER: { type: "container", className: "DeployRunner", dockerfile: "deploy-sandbox/Dockerfile", maxInstances: 1, instanceType: "basic", egress: egress(REGISTRIES, CRATES, GITHUB_HOSTS, ...Object.values(PROVIDER_HOSTS)) } as const,
      DEPLOY_SECRETS_KEY: op("DEPLOY_SECRETS_KEY/password"),
      // Only while rotating it: the key before, so what it sealed opens until an admin re-seals (README).
      DEPLOY_SECRETS_KEY_OLD: op("DEPLOY_SECRETS_KEY_OLD/password", true),
    } : {}),
    // Checks in containers: one Durable Object per repo, so one run at a time, each in its own
    // container (deploy-sandbox/ci.Dockerfile: git, bun and the deploy image's small server),
    // with no secrets at all. Two at once across the site caps the spend.
    ...(checks ? { CI_RUNNER: { type: "container", className: "CiRunner", dockerfile: "deploy-sandbox/ci.Dockerfile", maxInstances: 2, instanceType: "basic", egress: egress(REGISTRIES, GITHUB_HOSTS) } as const } : {}),
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
  // The ephemeral office preview (apps/agent-office/MOVE.md, #1385): `rustybuns deploy --stage office-preview`
  // with DEPLOYS=1 AGENTS=1 CHECKS=1, then `rustybuns destroy --stage office-preview` after verifying.
  // Every named resource has its own name, so the destroy touches nothing live; the live data bindings are protect: true, and this stage turns it off on its own copies.
  // No crons (nothing sweeps a throwaway), and Turnstile is off since its widget is tied to the live hostname.
  // Verify it with a throwaway repo and token, per apps/agent-office/PREVIEW.md.
  stages: {
    "office-preview": {
      workerName: "codesplitter-office-preview",
      crons: [],
      bindings: {
        DB: { databaseName: "codesplitter-office-preview-db", protect: false },
        LEVEL_CHUNKS: { bucketName: "codesplitter-office-preview-chunks", protect: false },
        STATS: { protect: false },
        HOOKS: { queueName: "codesplitter-office-preview-hooks" },
        JOBS: { queueName: "codesplitter-office-preview-jobs" },
        FIXES: { queueName: "codesplitter-office-preview-fixes" },
        LEVEL_DIGS: { queueName: "codesplitter-office-preview-level-digs" },
        ARTIFACTS: { type: "artifacts", namespace: "office-preview" },
        ARTIFACTS_NEXT: { type: "artifacts", namespace: "office-preview-next" },
        AUTH_LIMIT: { namespaceId: "6471" },
        BETTER_AUTH_URL: { value: "https://codesplitter-office-preview.notryanquinn.workers.dev" },
        TURNSTILE_SITE_KEY: { value: "" },
      },
    },
  },
  targets: {
    // Live as D1 codesplitters-db, first deployed with wrangler; adopted by rustybuns deploy on
    // 2026-10-09 (#170). Keep adopt on: a new clone or stage starts with empty state, and adopt
    // takes these over instead of duplicating them (it's how the copies made by
    // scripts/move-resources.ts are taken over, too). The Worker was renamed to codesplitter on
    // 2026-10-11, and renamedFrom moved its files, game rooms and search over with their data.
    // The containers started empty.
    // D1 migrations are Alchemy's (__alchemy_migrations); never apply them with wrangler (README).
    edge: { provider: "cloudflare", adopt: true, workerName: "codesplitter", renamedFrom: "codesplitters" },
    // The desktop's data stays in ~/.codesplitters, where its repos, scripts/phone.ts and
    // scripts/runner.ts find it; the app's name would put it in ~/.codesplitter.
    desktop: { mode: "worker", window: "app", dataDir: "~/.codesplitters" },
  },
});
