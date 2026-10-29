import { defineConfig } from "@rustybuns/cli/config";

// The game runs in the page. The Worker (wrangler.jsonc) only fetches NOAA's wind grid for it; on the
// desktop, with no network, the page plays on a synthetic wind field and says so.
export default defineConfig({
  name: "alien-disc-golf",
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
