import { defineConfig } from "@rustybuns/cli/config";

// Desktop app: the page rigs with TypeScript in a Web Worker, and the host
// rigs with Rust over bun:ffi through the "use server" action in src/actions,
// or with TypeScript on a worker thread (desktop.workers) without a Rust build.
export default defineConfig({
  name: "auto-rig",
  source: { dir: "src", aliases: {} },
  bindings: {},
  targets: {
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
