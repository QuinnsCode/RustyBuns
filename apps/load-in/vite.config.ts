import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", rollupOptions: { input: ["index.html", "feel.html"] } },
  worker: { format: "es" },
});
