import { defineConfig } from "@rustybuns/cli/config";

// The whole game runs in the page: a local 1v1 against a bot, no server yet.
export default defineConfig({
  name: "mythic-masters",
  source: { dir: "src", aliases: {} },
  bindings: {},
  targets: {
    desktop: { mode: "spa", clientBuild: "bun run build", clientDir: "dist/ui", world: false, window: "app" },
  },
});
