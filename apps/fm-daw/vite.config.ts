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
  // Five pages: the DAW, Q Amp (amp.html, the circuit amp live), Q Studio (studio.html, the gear room), Qollab Studio (jam.html, the jam room) and its studio builder (rooms.html).
  build: { target: "esnext", sourcemap: true, rollupOptions: { input: { main: resolve(__dirname, "index.html"), amp: resolve(__dirname, "amp.html"), studio: resolve(__dirname, "studio.html"), jam: resolve(__dirname, "jam.html"), rooms: resolve(__dirname, "rooms.html") } } },
});
