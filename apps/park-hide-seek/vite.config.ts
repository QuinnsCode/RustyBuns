import { defineConfig } from "vite";

export default defineConfig({
  // three.js plus the baked terrain: big for a web page, fine for a desktop app.
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 1500 },
});
