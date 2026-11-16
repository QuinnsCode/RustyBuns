import { defineConfig } from "vite";
import { precache } from "./scripts/precache.ts";

export default defineConfig({
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext" },
  plugins: [precache()],
});
