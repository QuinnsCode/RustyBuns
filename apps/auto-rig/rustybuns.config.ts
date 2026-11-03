import { defineConfig } from "@rustybuns/cli/config";

// Desktop app: the page rigs with TypeScript in a Web Worker, and the host
// rigs with Rust over bun:ffi through the "use server" action in src/actions,
// or with TypeScript on a worker thread (desktop.workers) without a Rust build.
// On the web it is the page alone (an assets-only Worker): the action has no host, so the
// page rigs in its Web Worker and keeps nothing between visits.
export default defineConfig({
  name: "auto-rig",
  source: { dir: "src", aliases: {} },
  worker: { assets: "dist/client", compatibilityDate: "2026-09-01", compatibilityFlags: [], build: "bun run build" },
  bindings: {},
  targets: {
    edge: { provider: "cloudflare", adopt: true, workerName: "auto-rig" },
    desktop: {
      mode: "spa",
      clientBuild: "bunx vite build --config vite.desktop.config.ts",
      clientDir: "dist/desktop",
      world: false,
      native: ["auto_rig"],
      window: "app",
      dataDir: "~/.auto-rig",
      workers: ["src/rig/worker.ts"],
      // One rigger stays loaded between rigs: a warm one keeps analyze() JIT'd, about 2x faster.
      warm: 1,
    },
  },
});
