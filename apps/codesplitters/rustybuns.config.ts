import { defineConfig } from "@rustybuns/cli/config";

// A deploy needs every declared secret, so the optional ones are only declared
// when they're switched on in the deploying shell:
//   CODESPLITTERS_AGENTS=1  hosted coding agents (super experimental, see README)
//   BETTER_AUTH_SECRET      accounts; without it the site uses aliases
//   GITHUB_/GOOGLE_CLIENT_ID  that sign-in, with its _SECRET
const agents = process.env.CODESPLITTERS_AGENTS === "1";
const secrets = (on: boolean, ...names: string[]) => on ? Object.fromEntries(names.map((n) => [n, { type: "secret" as const }])) : {};
const set = (name: string) => !!process.env[name];
// Hosted agents bill the site's keys and are limited to ADMINS, which only means
// something with accounts: with aliases anyone can claim an admin's handle.
if (agents && !set("BETTER_AUTH_SECRET")) throw new Error("CODESPLITTERS_AGENTS=1 needs accounts on: set BETTER_AUTH_SECRET too");

export default defineConfig({
  name: "codesplitters",
  worker: {
    main: "src/worker.ts",
    builtMain: "dist/worker/worker.js",
    assets: "dist/client",
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],   // Better Auth leans on Node APIs (AsyncLocalStorage)
    build: "bun run build.ts",
    // Hourly: each repo's dependency doctor runs when its own schedule says it's due (src/deps.ts).
    crons: ["0 * * * *"],
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
    // Accounts (Better Auth). Unset on the desktop: it uses aliases.
    ...secrets(set("BETTER_AUTH_SECRET"), "BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: { type: "var", value: "https://codesplitters.notryanquinn.workers.dev" },
    ...secrets(set("GITHUB_CLIENT_ID"), "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"),
    ...secrets(set("GOOGLE_CLIENT_ID"), "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"),
    // Handles allowed to excavate levels once accounts are on.
    ADMINS: { type: "var", value: "" },
  },
  targets: {
    // Live as Worker codesplitters + D1 codesplitters-db, first deployed with wrangler;
    // adopted by rustybuns deploy on 2026-10-09 (#170). Keep adopt on: state is local.
    edge: { provider: "cloudflare", adopt: true },
    desktop: { mode: "worker", window: "app" },
  },
});
