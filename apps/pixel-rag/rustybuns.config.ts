import { defineConfig } from "@rustybuns/cli/config";

// Desktop app: the page searches with Rust wasm (or the TypeScript twin) in Web Workers on one
// shared memory, and the host races the same search on Bun workers running the crate over
// bun:ffi through the "use server" action in src/actions. On the web it is the page alone (an
// assets-only Worker, cross-origin isolated by public/_headers): no host, so no native lanes.
export default defineConfig({
  name: "pixel-rag",
  source: { dir: "src", aliases: {} },
  worker: { assets: "dist/client", compatibilityDate: "2026-09-01", compatibilityFlags: [], build: "bun run build" },
  bindings: {},
  targets: {
    edge: { provider: "cloudflare", adopt: true, workerName: "pixel-rag" },
    desktop: {
      mode: "spa",
      clientBuild: "bunx vite build --config vite.desktop.config.ts",
      clientDir: "dist/desktop",
      world: false,
      native: ["pixel_rag"],
      window: "app",
      dataDir: "~/.pixel-rag",
      workers: ["src/engine/host-worker.ts"],
    },
  },
});
