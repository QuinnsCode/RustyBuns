import { defineConfig } from "@rustybuns/cli/config";

// The campaign and the ground battle run in the page: against the AI or hotseat, no backend. An
// online campaign needs the Worker and its Durable Object (wrangler.jsonc), so the desktop build
// plays the first two.
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
