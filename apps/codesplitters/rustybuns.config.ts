import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  name: "codesplitters",
  worker: {
    main: "src/worker.ts",
    builtMain: "dist/worker/worker.js",
    assets: "dist/client",
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],   // Better Auth leans on Node APIs (AsyncLocalStorage)
    build: "bun run build.ts",
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
    // Hosted coding agents: one container per run, each CLI installed (sandbox/Dockerfile).
    // The desktop has no twin and runs the CLIs on the machine instead.
    AGENT_SANDBOX: { type: "container", className: "AgentSandbox", dockerfile: "sandbox/Dockerfile", maxInstances: 2, instanceType: "basic" },
    // The CLIs' logins inside the container. Set the ones for the harnesses you use.
    ANTHROPIC_API_KEY: { type: "secret" },        // claude, pi, opencode
    CLAUDE_CODE_OAUTH_TOKEN: { type: "secret" },  // claude, from `claude setup-token`
    OPENAI_API_KEY: { type: "secret" },           // codex, pi, opencode
    CODEX_API_KEY: { type: "secret" },            // codex exec
    // Accounts (Better Auth). Unset on the desktop: it uses aliases. GitHub and
    // Google sign-in appear only when their pair is set.
    BETTER_AUTH_SECRET: { type: "secret" },
    BETTER_AUTH_URL: { type: "var", value: "https://codesplitters.notryanquinn.workers.dev" },
    GITHUB_CLIENT_ID: { type: "secret" },
    GITHUB_CLIENT_SECRET: { type: "secret" },
    GOOGLE_CLIENT_ID: { type: "secret" },
    GOOGLE_CLIENT_SECRET: { type: "secret" },
    // Handles allowed to excavate levels once accounts are on.
    ADMINS: { type: "var", value: "" },
  },
  targets: {
    edge: { provider: "cloudflare" },
    desktop: { mode: "worker", window: "app" },
  },
});
