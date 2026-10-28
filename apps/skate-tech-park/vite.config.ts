import { defineConfig } from "vite";

export default defineConfig({
  // scenarios.html is the jump-to-a-state page (src/scenarios.ts), shipped beside the game.
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 1000, rollupOptions: { input: { index: "index.html", scenarios: "scenarios.html" } } },
});
