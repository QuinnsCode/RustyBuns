import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  name: "codesplitters",
  worker: {
    main: "src/worker.ts",
    builtMain: "dist/worker/worker.js",
    assets: "dist/client",
    compatibilityDate: "2026-06-01",
    compatibilityFlags: [],
    build: "bun run build.ts",
  },
  bindings: {
    // Profiles, repos, playlists and the search index.
    DB: { type: "d1", databaseName: "codesplitters-db", migrationsDir: "migrations" },
    // One Durable Object per file.
    FILES: { type: "durable_object", className: "FileDurableObject" },
    // One git repo per excavation; cataloguing pushes to it.
    ARTIFACTS: { type: "artifacts", namespace: "codesplitters" },
  },
  targets: {
    edge: { provider: "cloudflare" },
    desktop: { mode: "worker", window: "app" },
  },
});
