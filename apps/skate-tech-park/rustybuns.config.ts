import { defineConfig } from "@rustybuns/cli/config";

// The whole ride runs in the page, so the desktop build is the page in a window.
export default defineConfig({
  name: "rocket-skate",
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
