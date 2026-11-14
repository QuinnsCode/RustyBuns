// Plain browser build: `bun run dev` for hot reload, and the Cloudflare assets.
// No desktop host here, so "use server" actions become proxies that fail, and
// the page falls back (bounce downloads, host lanes say "desktop only").
// .rustybuns/vite.ts is written by `bunx rustybuns build desktop` (not `generate`):
// run `bun run desktop:dev` once before `bun run dev`.
import { defineConfig } from "vite";
import { resolve } from "node:path";
import { rustybuns } from "./.rustybuns/vite";

const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
export default defineConfig({
  plugins: [rustybuns()],
  esbuild: { jsx: "automatic" },
  server: { headers: isolation },
  preview: { headers: isolation },
  // Two pages: the DAW, and Q Amp (amp.html, the circuit amp live).
  build: { target: "esnext", sourcemap: true, rollupOptions: { input: { main: resolve(__dirname, "index.html"), amp: resolve(__dirname, "amp.html") } } },
});
