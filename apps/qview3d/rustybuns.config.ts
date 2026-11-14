import { defineConfig } from "@rustybuns/cli/config";

// QView3D: one Worker and one R2 bucket. The Worker serves the widget script (static assets), signs uploads,
// takes them into R2, and serves textures and snapshots back with year-long immutable caching, since every
// served key is named by its own SHA-256. Every org's objects sit under orgs/<org>/ (src/layout.ts).
//
// Secrets (see .env.schema): UPLOAD_SECRET signs the short-lived upload URLs. The four R2_* values are optional:
// with them set, uploads go straight to R2 on an S3 presigned PUT instead of through the Worker (src/sign.ts).
// MESHY_API_KEY (optional) turns on samples: a shop's own product made from its photos (src/samples.ts).
export default defineConfig({
  name: "qview3d",
  worker: {
    main: "src/worker.ts",
    assets: "dist/client",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: [],
    build: "bun run build",
  },
  bindings: {
    // orgs/<org>/{org.json, products/, originals/, textures/, snapshots/, designs/}. See src/layout.ts.
    BUCKET: { type: "r2", bucketName: "qview3d", protect: true },
    UPLOAD_SECRET: { type: "secret", op: "op://qview3d/upload-secret/password" },
    R2_ACCOUNT_ID: { type: "secret", op: "op://qview3d/r2-account-id/password", optional: true },
    R2_ACCESS_KEY_ID: { type: "secret", op: "op://qview3d/r2-access-key-id/password", optional: true },
    R2_SECRET_ACCESS_KEY: { type: "secret", op: "op://qview3d/r2-secret-access-key/password", optional: true },
    // Samples (a shop's own product from its photos) go to Meshy's multi-image-to-3D on this key. Without it they answer 503.
    MESHY_API_KEY: { type: "secret", op: "op://qview3d/meshy-api-key/password", optional: true },
    // The most samples a day across every org: the ceiling on the Meshy bill (src/samples.ts).
    MESHY_DAILY: { type: "var", value: "50" },
    // Signs a minute per IP and org, and sample starts a minute per org (src/worker.ts answers 429). Counted at each location, free.
    SIGN_LIMIT: { type: "ratelimit", namespaceId: "8205", simple: { limit: 60, period: 60 } },
    SAMPLE_LIMIT: { type: "ratelimit", namespaceId: "8206", simple: { limit: 5, period: 60 } },
  },
  // Secrets resolve at deploy through varlock, behind the owner's Touch ID; op: references need the wheel.
  experimental: { wheel: "human" },
  targets: {
    // qview3d.<subdomain>.workers.dev. `bun run plan` shows what it makes (a Worker and the bucket), `bun run deploy` makes it.
    edge: { provider: "cloudflare", workerName: "qview3d" },
  },
});
