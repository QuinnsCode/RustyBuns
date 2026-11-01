import { defineConfig } from "vite";
import { devBeasts } from "./dev-beasts.ts";

export default defineConfig({
  plugins: [devBeasts()],
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 1200 },
});
