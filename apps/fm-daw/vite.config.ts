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
  // The WAM SDK sends its audio-thread classes over as text (src/ui/wam.ts). Pre-bundled, their static fields become
  // helper calls that text doesn't carry, and a web plugin never starts: it's served as it is.
  optimizeDeps: { exclude: ["@webaudiomodules/sdk"] },
  server: { headers: isolation },
  preview: { headers: isolation },
  // Six pages: the DAW, Q Amp (amp.html, the circuit amp live), Qollab Studio's gear room (studio.html), Qollab Studio (jam.html, the lobby and the jam room), its studio builder (rooms.html) and its remote (remote.html, one screen for a phone).
  build: { target: "esnext", sourcemap: true, rollupOptions: { input: { main: resolve(__dirname, "index.html"), amp: resolve(__dirname, "amp.html"), studio: resolve(__dirname, "studio.html"), jam: resolve(__dirname, "jam.html"), rooms: resolve(__dirname, "rooms.html"), remote: resolve(__dirname, "remote.html") } } },
});
