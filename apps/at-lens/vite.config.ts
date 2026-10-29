import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext" },
  // Lookups: run `bunx wrangler dev` beside `bun run dev`, and the page's /api reaches it.
  server: { proxy: { "/api": "http://localhost:8787" } },
});
