import { defineConfig } from "@rustybuns/cli/config";

// Solo runs in the page. Friends play together online by room code on the edge
// build (src/edge/worker.ts); the desktop world is the same match, run in-process.
export default defineConfig({
  name: "splat-spray",
  source: { dir: "src", aliases: {} },
  bindings: {},
  targets: {
    desktop: {
      mode: "spa",
      clientBuild: "bun run build",
      clientDir: "dist/ui",
      world: "packages/desktop/world.ts",
      worldPath: "/ws",
      window: "app",
    },
  },
});
