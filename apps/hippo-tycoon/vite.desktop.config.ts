// A plain SPA build of the desktop entry (packages/desktop/index.html), embedded
// into the binary. No Worker plugins: the world is src/room-do.ts, run in-process.
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "packages/desktop"),
  // public/ is the app's, not the desktop entry's: hippo_fluid.wasm lives there.
  publicDir: resolve(__dirname, "public"),
  esbuild: { jsx: "automatic" },
  build: {
    outDir: resolve(__dirname, "dist/desktop"),
    emptyOutDir: true,
    target: "esnext",
    chunkSizeWarningLimit: 1500,
  },
});
