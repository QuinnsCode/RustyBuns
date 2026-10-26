import { defineConfig } from "@rustybuns/cli/config";

// The whole game runs in the page: the sim, the synth and the drawing. No bindings, so the
// desktop build is the same page in a window.
export default defineConfig({
  name: "delayed-reaction",
  source: { dir: "src", aliases: {} },
  bindings: {},
  targets: {
    desktop: { mode: "spa", clientBuild: "bun run build", clientDir: "dist/ui", world: false, window: "app" },
  },
});
