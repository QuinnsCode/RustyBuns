import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  name: "fm-daw",
  worker: {
    main: "src/worker.ts",
    builtMain: "dist/worker/worker.js",
    assets: "dist/client",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: [],
    build: "vite build --outDir dist/client",
  },
  // The edge's World. The desktop runs the same class in-process (desktop.world).
  bindings: {
    WORLD: { type: "durable_object", className: "World" },
  },
  targets: {
    edge: { provider: "cloudflare" },
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
