import { defineConfig } from "@rustybuns/cli/config";

// One Worker, no storage. The song is analysed in the browser and never uploaded:
// the Worker only ever sees ~1 KB of numbers, and spends one small Claude call on it.
//
// Secrets come from 1Password through varlock (experimental.wheel "human"), never the
// shell. Both are optional: with no ANTHROPIC_API_KEY the review is the canned one
// (src/fake.ts), and the Worker refuses to spend a live call without TURNSTILE_SECRET.
const op = (ref: string) => ({ type: "secret" as const, op: `op://fantano/${ref}`, optional: true as const });

// Cloudflare Turnstile's site key (public). Empty means no widget, and so no live calls.
const turnstileSiteKey = "";

export default defineConfig({
  name: "what-would-fantano-say",
  experimental: { wheel: "human" },
  worker: {
    main: "src/worker.tsx",
    builtMain: "dist/worker/index.js",
    assets: "dist/client",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    build: "bun run build",
  },
  bindings: {
    // A few reviews a minute per address (src/guard.ts). Cloudflare's limiter, so it's per colo.
    REVIEW_LIMIT: { type: "ratelimit", namespaceId: "7401", simple: { limit: 4, period: 60 } },
    TURNSTILE_SITE_KEY: { type: "var", value: turnstileSiteKey },
    // claude-haiku-5-5 is ~40x cheaper per review, if the jokes hold up on it.
    REVIEW_MODEL: { type: "var", value: "claude-opus-5-5" },
    ANTHROPIC_API_KEY: op("anthropic/api-key"),
    TURNSTILE_SECRET: op("turnstile/secret"),
  },
  targets: {
    edge: { provider: "cloudflare" },
  },
});
