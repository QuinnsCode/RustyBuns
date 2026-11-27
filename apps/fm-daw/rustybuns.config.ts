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
    // Online only: one per person, their chat name and chat layout (src/profile.ts).
    PROFILE: { type: "durable_object", className: "Profile" },
    // Online only: one per live set, relaying the DJ's stream to its listen link (src/listen.ts, #5878).
    LISTEN: { type: "durable_object", className: "Listen" },
    // Every sesh's groove, copied out of its World, so a reset Durable Object gets it back.
    BACKUP: { type: "r2", bucketName: "fm-daw-seshes", protect: true },
    // Rooms open at once, seshes kept at all (the storage cap), and players in one room.
    // Past any of them, a visitor gets the sign-up list.
    MAX_ROOMS: { type: "var", value: "50" },
    MAX_SESHES: { type: "var", value: "2000" },
    ROOM_SEATS: { type: "var", value: "16" },
    // A free live set's limits (src/listen.ts, src/lobby.ts): listeners at once, hours one set runs, and set-hours a
    // month for each DJ key and each address. Past one, the DJ (or listener) gets the paid waitlist.
    LISTEN_EARS: { type: "var", value: "16" },
    LISTEN_SET_HOURS: { type: "var", value: "4" },
    FREE_SET_HOURS: { type: "var", value: "16" },
    // Reads the sign-up lists and the live sets' usage (GET /signups, /signups?list=paid, /usage with
    // "Authorization: Bearer <token>"). Missing, nobody can.
    SIGNUPS_TOKEN: { type: "secret", op: "op://fm-daw/signups/password", optional: true },
    // Cloudflare Realtime's TURN key, so two players behind strict networks still hear each other's guitar (GET /ice,
    // src/worker.ts). Billed per GB relayed. Missing, a guitar call gets STUN alone.
    TURN_KEY_ID: { type: "secret", op: "op://fm-daw/turn-key-id/password", optional: true },
    TURN_KEY_API_TOKEN: { type: "secret", op: "op://fm-daw/turn-key-token/password", optional: true },
  },
  targets: {
    // The URL is fm-daw.<subdomain>.workers.dev, the play link apps/playground/public/apps.json gets.
    edge: { provider: "cloudflare", adopt: true, workerName: "fm-daw" },
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
