import { defineConfig } from "@rustybuns/cli/config";

// On the web it is the page alone (an assets-only Worker, no code of its own): the browser
// lane renders with the TypeScript engine, and the host lanes say they need the desktop app.
export default defineConfig({
  name: "motion-midi",
  worker: {
    assets: "dist/client",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: [],
    build: "bun run build",
  },
  bindings: {},
  targets: {
    edge: { provider: "cloudflare", adopt: true, workerName: "motion-midi" },
    desktop: {
      mode: "spa",
      clientBuild: "bunx vite build --config vite.desktop.config.ts",
      clientDir: "dist/desktop",
      world: "packages/desktop/world.ts",
      worldPath: "/ws",
      window: "app",
    },
  },
  source: { dir: "src", aliases: {} },
});
