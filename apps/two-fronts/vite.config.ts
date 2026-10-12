import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 1000 },
  // Online campaigns: run `bunx wrangler dev` beside `bun run dev`, and the page's API calls reach it.
  server: { proxy: { "/api": "http://localhost:8787" } },
});
