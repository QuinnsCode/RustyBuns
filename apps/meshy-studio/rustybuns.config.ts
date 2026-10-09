import { defineConfig } from "@rustybuns/cli/config";

// Desktop-only app: it has to see the user's folders, so no Cloudflare target.
// `vite build` makes the UI, desktop/host.ts is the backend and owns the Meshy key.
export default defineConfig({
  name: "meshy-studio",
  source: { dir: "src", aliases: {} },
  bindings: {},
  targets: {
    desktop: {
      mode: "spa",
      clientBuild: "bun run build",
      clientDir: "dist/ui",
      world: false,
      host: "desktop/host.ts",
      window: "app",
      dataDir: "~/.meshy-studio",
    },
  },
});
