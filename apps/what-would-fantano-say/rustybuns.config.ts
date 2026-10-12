import { defineConfig } from "@rustybuns/cli/config";

// One Worker. The browser decodes the song, measures it and cuts the listener's best
// 15 seconds; Clef-omni (Workers AI) listens to that clip and answers four typed
// questions, about $0.00005 a review; templates write the text. Nothing is stored.
//
// Live reviews need all of AI, BUDGET, a Turnstile site key and TURNSTILE_SECRET (from
// 1Password through varlock, experimental.wheel "human"). Missing any, the review is the
// free estimate from the numbers, which is what local dev always gets.
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
    // Workers AI, for Clef-omni. Billed per input token; there's no spend cap, hence BUDGET.
    AI: { type: "ai" },
    // Counts today's Clef calls (src/budget-do.ts) and stops at DAILY_REVIEWS: 25,000 is ~$1.20 a day, worst case.
    BUDGET: { type: "durable_object", className: "ReviewBudget" },
    DAILY_REVIEWS: { type: "var", value: "25000" },
    // A few reviews a minute per address. Cloudflare's limiter, so it's per colo.
    REVIEW_LIMIT: { type: "ratelimit", namespaceId: "7401", simple: { limit: 4, period: 60 } },
    TURNSTILE_SITE_KEY: { type: "var", value: turnstileSiteKey },
    TURNSTILE_SECRET: op("turnstile/secret"),
  },
  targets: {
    edge: { provider: "cloudflare" },
  },
});
