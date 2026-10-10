import { defineConfig } from "@rustybuns/cli/config";

// Accounts and admin secrets live in 1Password (vault "codesplitters") and reach
// the deploy through varlock: experimental.wheel "human" unlocks them with your
// Touch ID, so there's nothing to export and BETTER_AUTH_SECRET never drifts.
// See .env.schema for the full list. The desktop has none of them: it uses aliases.
//
// Hosted coding agents are still opt-in from the deploying shell:
//   CODESPLITTERS_AGENTS=1  hosted coding agents (super experimental, see README)
const agents = process.env.CODESPLITTERS_AGENTS === "1";
const secrets = (on: boolean, ...names: string[]) => on ? Object.fromEntries(names.map((n) => [n, { type: "secret" as const }])) : {};
const op = (ref: string) => ({ type: "secret" as const, op: `op://codesplitters/${ref}` });

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
    // Every five minutes: webhook retries (src/hooks.ts). Hourly: each repo's dependency
    // doctor runs when its own schedule says it's due (src/deps.ts).
    crons: ["*/5 * * * *", "0 * * * *"],
  },
  bindings: {
    // Profiles, repos, playlists and the search index.
    DB: { type: "d1", databaseName: "codesplitters-db", migrationsDir: "migrations" },
    // One Durable Object per file.
    FILES: { type: "durable_object", className: "FileDurableObject" },
    // One game room per level or repo: the lobby on its page, then the relay.
    GAMES: { type: "durable_object", className: "GameRoom" },
    // One git repo per excavation; cataloguing pushes to it.
    ARTIFACTS: { type: "artifacts", namespace: "codesplitters" },
    // Hosted coding agents (super experimental): one container per run, each CLI
    // installed (sandbox/Dockerfile), with the logins for the harnesses you use.
    // The desktop has no twin and runs the CLIs on the machine instead.
    ...(agents ? { AGENT_SANDBOX: { type: "container", className: "AgentSandbox", dockerfile: "sandbox/Dockerfile", maxInstances: 2, instanceType: "basic" } as const } : {}),
    ...secrets(agents, "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY"),
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
  },
  targets: {
    // Live as Worker codesplitters + D1 codesplitters-db, first deployed with wrangler;
    // adopted by rustybuns deploy on 2026-10-09 (#170). Keep adopt on: state is local.
    edge: { provider: "cloudflare", adopt: true },
    desktop: { mode: "worker", window: "app" },
  },
});
