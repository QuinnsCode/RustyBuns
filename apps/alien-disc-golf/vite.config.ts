import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 1200 },
  // Real wind: run `bunx wrangler dev` beside `bun run dev`, and the page's /api/wind reaches it.
  // Without it the page plays on a synthetic wind field and says so.
  server: { proxy: { "/api": "http://localhost:8787" } },
});
