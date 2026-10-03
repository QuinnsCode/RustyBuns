// Plain browser build: `bun run dev` for hot reload, and the Cloudflare assets.
// No desktop host here, so "use server" actions become proxies that fail, and
// the page falls back (bounce downloads, host lanes say "desktop only").
// Run `bunx rustybuns generate` once so .rustybuns/vite exists.
import { defineConfig } from "vite";
import { rustybuns } from "./.rustybuns/vite";

const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
export default defineConfig({
  plugins: [rustybuns()],
  esbuild: { jsx: "automatic" },
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { target: "esnext", sourcemap: true },
});
