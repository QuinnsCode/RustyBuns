import { defineConfig } from "@rustybuns/cli/config";

// The whole game runs in the page: a local 1v1 against a bot, no server yet. On the web it is
// an assets-only Worker (the built page, no code of its own); the URL is
// mythic-masters.<subdomain>.workers.dev, the origin eqosys signs players in from (#2994).
export default defineConfig({
  name: "mythic-masters",
  source: { dir: "src", aliases: {} },
  worker: { assets: "dist/ui", compatibilityDate: "2026-09-01", compatibilityFlags: [], build: "bun run build" },
  bindings: {},
  targets: {
    edge: { provider: "cloudflare", adopt: true, workerName: "mythic-masters" },
    desktop: { mode: "spa", clientBuild: "bun run build", clientDir: "dist/ui", world: false, window: "app" },
  },
});
