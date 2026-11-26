// Plain browser build: `bun run dev` for hot reload, and the Cloudflare assets.
// No desktop host here, so "use server" actions become proxies that fail, and
// the page falls back (bounce downloads, host lanes say "desktop only").
// .rustybuns/vite.ts is written by `bunx rustybuns build desktop` (not `generate`):
// run `bun run desktop:dev` once before `bun run dev`.
import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { rustybuns } from "./.rustybuns/vite";

const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
// Every page is isolated in dev but the jam room and the decks, as public/_headers has it live: a deck plays a YouTube
// video in YouTube's own player (src/dj/youtube.ts), and an isolated page refuses that frame.
const open = /^\/(jam|decks)(\.html)?(\?|$)/;
const headers = (s: { middlewares: { use(f: (req: { url?: string }, res: { setHeader(k: string, v: string): void }, next: () => void) => void): void } }) =>
  void s.middlewares.use((req, res, next) => { if (!open.test(req.url ?? "")) for (const [k, v] of Object.entries(isolation)) res.setHeader(k, v); next(); });
const isolate: Plugin = { name: "isolate-but-the-decks", configureServer: headers, configurePreviewServer: headers };
export default defineConfig({
  plugins: [rustybuns(), isolate],
  esbuild: { jsx: "automatic" },
  // The WAM SDK sends its audio-thread classes over as text (src/ui/wam.ts). Pre-bundled, their static fields become
  // helper calls that text doesn't carry, and a web plugin never starts: it's served as it is.
  // react/jsx-dev-runtime is found late otherwise (the scan reads JSX for production), and the page reloads a few
  // seconds in: named here, a fresh server never reloads a page under someone.
  optimizeDeps: { exclude: ["@webaudiomodules/sdk"], include: ["react/jsx-dev-runtime"] },
  // Eleven pages (a set's listen link, listen.html, served at /listen/<id>; the front door, door.html, naming LEARN, BUILD and PLAY; the decks on their own too, decks.html; the speaker plans, speakers.html): the DAW, Q Amp (amp.html, the circuit amp live), Q Builder (builder.html, a pedal's board to scope and remake), Qollab Studio's gear room (studio.html), Qollab Studio (jam.html, the lobby and the jam room), its studio builder (rooms.html) and its remote (remote.html, one screen for a phone).
  build: { target: "esnext", sourcemap: true, rollupOptions: { input: { main: resolve(__dirname, "index.html"), listen: resolve(__dirname, "listen.html"), amp: resolve(__dirname, "amp.html"), studio: resolve(__dirname, "studio.html"), jam: resolve(__dirname, "jam.html"), rooms: resolve(__dirname, "rooms.html"), remote: resolve(__dirname, "remote.html"), decks: resolve(__dirname, "decks.html"), door: resolve(__dirname, "door.html"), builder: resolve(__dirname, "builder.html"), speakers: resolve(__dirname, "speakers.html") } } },
});
