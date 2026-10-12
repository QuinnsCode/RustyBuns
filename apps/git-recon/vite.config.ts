import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 1500 },
});
