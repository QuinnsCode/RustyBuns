import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext" },
  // Lookups: run `bunx wrangler dev` beside `bun run dev`, and the page's /api and /xrpc reach it. Open the page on
  // 127.0.0.1 (localhost sends you there) to sign in as an OAuth loopback client.
  server: { host: "127.0.0.1", proxy: { "/api": "http://localhost:8787", "/xrpc": "http://localhost:8787" } },
});
