import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  name: "fm-daw",
  worker: {
    main: "src/worker.ts",           // alchemy bundles this itself; the Durable Object is plain TS
    assets: "dist/client",
    runWorkerFirst: ["/"],               // a bare visit gets a new sesh name (src/worker.ts)
    compatibilityDate: "2026-09-01",
    compatibilityFlags: [],
    build: "bun run build",
  },
  experimental: { wheel: "human" },
  // The edge's World. The desktop runs the same class in-process (desktop.world).
  bindings: {
    WORLD: { type: "durable_object", className: "World" },
    // Online only: counts the open rooms and keeps the sign-up list (src/lobby.ts).
    LOBBY: { type: "durable_object", className: "Lobby" },
    // Every sesh's groove, copied out of its World, so a reset Durable Object gets it back.
    BACKUP: { type: "r2", bucketName: "fm-daw-seshes", protect: true },
    // Rooms open at once, seshes kept at all (the storage cap), and players in one room.
    // Past any of them, a visitor gets the sign-up list.
    MAX_ROOMS: { type: "var", value: "50" },
    MAX_SESHES: { type: "var", value: "2000" },
    ROOM_SEATS: { type: "var", value: "16" },
    // Reads the sign-up list (GET /signups with "Authorization: Bearer <token>"). Missing, nobody can.
    SIGNUPS_TOKEN: { type: "secret", op: "op://fm-daw/signups/password", optional: true },
  },
  targets: {
    edge: { provider: "cloudflare" },
    desktop: {
      mode: "spa",
      clientBuild: "bunx vite build --config vite.desktop.config.ts",
      clientDir: "dist/desktop",
      world: "packages/desktop/world.ts",
      worldPath: "/ws",
      window: "app",
    },
  },
  source: { dir: "src", aliases: {} },
});
