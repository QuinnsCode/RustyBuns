import { defineConfig } from "@rustybuns/cli/config";
import { LAN_VERSION } from "./src/engine/wire.ts";

export default defineConfig({
  name: "hippo-tycoon",
  worker: {
    main: "src/worker.ts",           // alchemy bundles this itself: pure TS, no node deps
    assets: "dist/client",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: [],
    build: "bunx vite build --outDir dist/client",
  },
  // The edge's World. The desktop runs the very same class in-process (desktop.world).
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
      // LAN party: the host's page opens the lobby at runtime. Three guests + the host = four seats.
      // Guests must speak the same wire protocol (a browser page cannot know the host's build string).
      guests: { max: 3, version: LAN_VERSION },
    },
  },
  source: { dir: "src", aliases: {} },
});
