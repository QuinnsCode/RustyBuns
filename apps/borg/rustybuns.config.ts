import { defineConfig } from "@rustybuns/cli/config";

// Slim borg: one Worker that touches every binding once, so `bun borg.ts <url>` can check
// that the local twins and the real cloud give the same answers.
export default defineConfig({
  name: "borg-slim",
  worker: {
    main: "src/worker.ts",
    compatibilityDate: "2026-06-01",
    compatibilityFlags: [],
  },
  bindings: {
    DB: { type: "d1", databaseName: "borg-slim-db" },
    KV: { type: "kv" },
    BUCKET: { type: "r2", bucketName: "borg-slim" },
    PROBE: { type: "durable_object", className: "Probe" },
    JOBS: { type: "queue", queueName: "borg-slim-jobs", consumer: { batchSize: 10, maxWaitTimeMs: 1000 } },
  },
  targets: {
    edge: { provider: "cloudflare" },
    desktop: { mode: "worker" },
  },
});
