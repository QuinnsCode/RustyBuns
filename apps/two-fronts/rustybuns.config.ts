import { defineConfig } from "@rustybuns/cli/config";

// A single-player game with no backend: the campaign and the ground battle both run in the page.
export default defineConfig({
  name: "two-fronts",
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
