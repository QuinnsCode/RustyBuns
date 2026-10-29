import { defineConfig } from "vite";

export default defineConfig({
  // src/beasts.ts imports the rigger and IK from apps/auto-rig; one copy of three for both
  resolve: { dedupe: ["three"] },
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 1200 },
});
