import { defineConfig } from "@rustybuns/cli/config";

// A Wasp app's output shape (a client and an Express server on Postgres), on the desktop.
// public/ is the client; server/server.js is the app's own Node server, run beside the host
// (desktop.server) on the paths it answers. DATABASE_URL set, it is that Postgres; unset, the
// host runs PGlite in the data dir, applies migrations/ at boot, and hands the server its URL.
export default defineConfig({
  name: "express-example",
  bindings: {
    DATABASE_URL: { type: "secret", optional: true },
    HYPERDRIVE: { type: "hyperdrive", urlSecret: "DATABASE_URL", local: "pglite", migrationsDir: "migrations" },
  },
  targets: {
    desktop: { mode: "spa", clientDir: "public", world: false, server: { entry: "server/server.js", paths: ["^/$", "/increment"] } },
  },
});
