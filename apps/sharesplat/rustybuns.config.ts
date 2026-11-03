import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  name: "sharesplat",
  source: { dir: "src", aliases: {} },
  bindings: {},
  targets: {
    desktop: { mode: "spa", clientBuild: "bun run build", clientDir: "dist/ui", world: false, window: "app" },
  },
});
