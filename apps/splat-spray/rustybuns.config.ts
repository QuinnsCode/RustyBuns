import { defineConfig } from "@rustybuns/cli/config";

// Prototype: browser-only for now. The spray math moves into a host/Rust
// engine once the feel is right.
export default defineConfig({
  name: "splat-spray",
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
