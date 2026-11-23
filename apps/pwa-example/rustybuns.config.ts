import { defineConfig } from "@rustybuns/cli/config";

// The same page as a desktop app: the host serves dist/ui (the Vite build, service worker and all) in its own window.
export default defineConfig({
  name: "pwa-example",
  source: { dir: "src", aliases: {} },
  bindings: {},
  targets: {
    desktop: { mode: "spa", clientBuild: "bun run build", clientDir: "dist/ui", world: false, window: "app" },
  },
});
