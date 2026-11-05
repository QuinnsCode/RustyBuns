import { defineConfig } from "@rustybuns/cli/config";

// The whole game runs in the page: fights, the world, the save. On the web the Worker serves the built page and, for a
// party walking the world together (#3663), routes /ws to one Region Durable Object per occupied region of a party
// (src/edge/worker.ts): it relays poses from memory, no storage and no timer, so it hibernates when nobody moves.
// The URL is mythic-masters.<subdomain>.workers.dev, the origin eqosys signs players in from (#2994).
export default defineConfig({
  name: "mythic-masters",
  source: { dir: "src", aliases: {} },
  worker: { main: "src/edge/worker.ts", assets: "dist/ui", compatibilityDate: "2026-09-01", compatibilityFlags: [], build: "bun run build" },
  bindings: {
    REGION: { type: "durable_object", className: "Region" },
  },
  targets: {
    edge: { provider: "cloudflare", adopt: true, workerName: "mythic-masters" },
    desktop: { mode: "spa", clientBuild: "bun run build", clientDir: "dist/ui", world: false, window: "app" },
  },
});
