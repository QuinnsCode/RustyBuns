// Plain browser build for the Cloudflare assets. There is no desktop host on the web, so the
// "use server" bounce actions (Rust over bun:ffi, TS under Bun) become proxies that fail and
// the page renders with the TypeScript engine in the window. .rustybuns/vite.ts comes from
// `rustybuns boundary`, which `bun run build` runs first.
import { defineConfig } from "vite";
import { rustybuns } from "./.rustybuns/vite";

export default defineConfig({
  plugins: [rustybuns()],
  esbuild: { jsx: "automatic" },
  build: { target: "esnext", sourcemap: true },
});
