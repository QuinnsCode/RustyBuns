import { defineConfig } from "@rustybuns/cli/config";

// The campaign and the ground battle run in the page: against the AI or hotseat, no backend. An
// online campaign needs the Worker and its CampaignRoom Durable Object (src/edge/worker.ts), so
// `rustybuns plan` / `deploy` ship that, and the desktop build plays the first two.
export default defineConfig({
  name: "two-fronts",
  source: { dir: "src", aliases: {} },
  worker: {
    main: "src/edge/worker.ts",
    assets: "dist/ui",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: [],
    build: "bun run build",
    observability: { enabled: true },
  },
  bindings: {
    // protect: a destroy keeps the campaigns played so far.
    CAMPAIGN: { type: "durable_object", className: "CampaignRoom", protect: true },
  },
  targets: {
    // adopt: takes over the two-fronts Worker an earlier `wrangler deploy` made, campaigns and all.
    edge: { provider: "cloudflare", adopt: true, workerName: "two-fronts" },
    desktop: {
      mode: "spa",
      clientBuild: "bun run build",
      clientDir: "dist/ui",
      world: false,
      window: "app",
    },
  },
});
