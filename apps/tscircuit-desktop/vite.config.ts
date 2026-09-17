import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "circuit-json-to-altium": resolve(__dirname, "src/stubs/unavailable.ts") },
    // tscircuit packages share these as peers; one copy each, the app's.
    dedupe: ["react", "react-dom", "circuit-json", "@tscircuit/core", "@tscircuit/props", "zod"],
  },
  worker: { format: "es" },
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 30_000 },
  // tscircuit's browser bundles expect these Node-isms to exist.
  define: { global: "globalThis", "process.env": "{}" },
});
