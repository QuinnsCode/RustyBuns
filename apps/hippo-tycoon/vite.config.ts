// Browser build: `bun run dev` for hot reload, and the Cloudflare assets (dist/client).
import { defineConfig } from "vite";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  build: { target: "esnext", sourcemap: false, chunkSizeWarningLimit: 1500 },
});
