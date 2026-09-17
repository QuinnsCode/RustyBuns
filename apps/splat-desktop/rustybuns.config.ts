import { defineConfig } from "@rustybuns/cli/config";

// Desktop-only app. `bun run build` builds the shell UI into dist/ui and
// SuperSplat (unmodified, pinned) into dist/ui/editor; desktop/host.ts is the backend.
export default defineConfig({
  name: "splat-desktop",
  source: { dir: "src", aliases: {} },
  bindings: {},
  targets: {
    desktop: {
      mode: "spa",
      clientBuild: "bun run build",
      clientDir: "dist/ui",
      world: false,
      host: "desktop/host.ts",
      // Scenes and editor assets may come from CDNs without CORP headers.
      headers: { "Cross-Origin-Embedder-Policy": "credentialless" },
      window: "app",
      dataDir: "~/.splat-desktop",
    },
  },
});
