import { defineConfig } from "@rustybuns/cli/config";

// bedstack's RealWorld backend (Elysia + Drizzle + postgres.js), run unchanged. Everything Rusty
// Buns needs is this file, rustybuns/worker.ts and test/: nothing under src/ is edited. On the
// edge HYPERDRIVE fronts DATABASE_URL; on the desktop, with the URL unset, it is PGlite in the
// data dir with their Drizzle migrations applied at boot.
export default defineConfig({
  name: "elysia-conduit",
  worker: {
    main: "rustybuns/worker.ts",
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],
  },
  bindings: {
    DATABASE_URL: { type: "secret", optional: true },
    JWT_SECRET: { type: "secret", optional: true },
    HYPERDRIVE: { type: "hyperdrive", urlSecret: "DATABASE_URL", local: "pglite", migrationsDir: "drizzle/migrations" },
  },
  targets: {
    edge: { provider: "cloudflare" },
    desktop: { mode: "worker" },
  },
});
