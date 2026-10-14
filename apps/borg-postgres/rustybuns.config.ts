import { defineConfig } from "@rustybuns/cli/config";

// Thick borg, story 1: keep the database, move the code. A Postgres app (Neon, Supabase, RDS)
// keeps its database; only the code moves. On the edge `HYPERDRIVE` fronts DATABASE_URL, on the
// desktop and a box it is the URL itself, and with the URL unset the desktop runs PGlite.
export default defineConfig({
  name: "borg-postgres",
  worker: {
    main: "src/worker.ts",
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],
  },
  bindings: {
    DATABASE_URL: { type: "secret", optional: true },
    HYPERDRIVE: { type: "hyperdrive", urlSecret: "DATABASE_URL", local: "pglite" },
  },
  targets: {
    edge: { provider: "cloudflare" },
    desktop: { mode: "worker" },
  },
});
