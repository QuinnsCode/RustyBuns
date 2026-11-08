import { join } from "node:path";
import { defineConfig } from "vite";
import { devBeasts } from "./dev-beasts.ts";

// A rebuilt beast (scripts/beasts.ts --watch) writes public/models/<id>.rig.json last; tell the open page so it can swap that beast without a reload.
const beastHotSwap = {
  name: "beast-hot-swap",
  configureServer(server: import("vite").ViteDevServer) {
    const dir = join(server.config.root, "public", "models");
    server.watcher.add(dir);
    const changed = (file: string) => {
      const id = /[\\/]models[\\/]([a-z0-9-]+)\.rig\.json$/.exec(file)?.[1];
      if (id) server.ws.send({ type: "custom", event: "beast-changed", data: { id } });
    };
    server.watcher.on("change", changed);
    server.watcher.on("add", changed);
  },
};

export default defineConfig({
  plugins: [devBeasts(), beastHotSwap],
  build: { outDir: "dist/ui", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 1200 },
  // Walking together in dev (#3663): `bun scripts/party.ts` (a Bun stand-in) or `bun scripts/edge.ts` (workerd itself)
  // runs the Worker and its Region rooms on :8790, and a page
  // opened with ?world=1&room=CODE reaches them through here. Solo play never opens a socket, so nothing needs it running.
  // MM_PARTY moves it (the two-page test runs its own on a free port).
  server: { proxy: { "/ws": { target: `ws://127.0.0.1:${process.env.MM_PARTY ?? 8790}`, ws: true }, "/duel": { target: `ws://127.0.0.1:${process.env.MM_PARTY ?? 8790}`, ws: true } } },
});
