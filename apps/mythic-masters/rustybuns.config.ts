import { defineConfig } from "@rustybuns/cli/config";

// The whole game runs in the page: the fights, the journey and the save. On the web the Worker serves the built page
// and one thing more: /walk, a party's socket into the room for the region it walks (src/edge/worker.ts), one
// RegionRoom Durable Object per party and region, hibernating, with nothing in its storage (#3663; `bun scripts/cost.ts`
// prices it). The URL is mythic-masters.<subdomain>.workers.dev, the origin eqosys signs players in from (#2994).
export default defineConfig({
  name: "mythic-masters",
  source: { dir: "src", aliases: {} },
  worker: { main: "src/edge/worker.ts", assets: "dist/ui", compatibilityDate: "2026-09-01", compatibilityFlags: [], build: "bun run build" },
  bindings: {
    REGION: { type: "durable_object", className: "RegionRoom" },
  },
  targets: {
    edge: { provider: "cloudflare", adopt: true, workerName: "mythic-masters" },
    desktop: { mode: "spa", clientBuild: "bun run build", clientDir: "dist/ui", world: false, window: "app" },
  },
});
