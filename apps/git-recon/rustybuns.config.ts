import { defineConfig } from "@rustybuns/cli/config";

// Single player for now: the page runs the whole game, so the desktop app is just its window.
export default defineConfig({
  name: "git-recon",
  source: { dir: "src", aliases: {} },
  bindings: {},
  targets: {
    desktop: {
      mode: "spa",
      clientBuild: "bun run build",
      clientDir: "dist/ui",
      world: false,
      window: "app",
    },
  },
});
