import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 1500 },
  // A battle in dev: `bun run battle` serves the world here.
  server: { proxy: { "/ws": { target: "ws://127.0.0.1:4180", ws: true } } },
});
