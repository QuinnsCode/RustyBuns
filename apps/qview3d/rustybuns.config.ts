import { defineConfig } from "@rustybuns/cli/config";

// QView3D: one Worker, one R2 bucket and one D1 database. The Worker serves the widget script (static assets), signs
// uploads, takes them into R2, and serves textures and snapshots back with year-long immutable caching, since every
// served key is named by its own SHA-256. Every org's files sit under orgs/<org>/ (src/layout.ts); its settings and
// products are rows in D1 (src/settings.ts).
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
    // Once a minute: webhook deliveries whose retry is due (src/hooks.ts). Cron triggers are free on every plan.
    crons: ["* * * * *"],
    // An order makes its print files in the request (src/print-render.ts): a 30 x 40 cm tee front took ~6 s in workerd
    // locally, so the default 30 s fits only a few new ones. This is a cap, billed per ms used ($0.02 a million past
    // the plan's 30 million a month: about $0.0001 a tee front).
    cpuMs: 300_000,
  },
  bindings: {
    // orgs/<org>/{originals/, textures/, snapshots/, designs/, models/, ...}: the files. See src/layout.ts.
    BUCKET: { type: "r2", bucketName: "qview3d", protect: true },
    // Org and product settings (src/settings.ts). The migrations make the tables and seed the public demo org. Free tier.
    DB: { type: "d1", databaseName: "qview3d-db", protect: true, migrationsDir: "migrations" },
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
    // Shops buy packs of samples through Stripe Checkout (src/billing.ts). Without the key, buying answers 501.
    STRIPE_SECRET_KEY: { type: "secret", op: "op://qview3d/stripe-secret-key/password", optional: true },
    STRIPE_WEBHOOK_SECRET: { type: "secret", op: "op://qview3d/stripe-webhook-secret/password", optional: true },
  },
  // Secrets resolve at deploy through varlock, behind the owner's Touch ID; op: references need the wheel.
  experimental: { wheel: "human" },
  targets: {
    // qview3d.<subdomain>.workers.dev. `bun run plan` shows what it makes (a Worker, the bucket and the D1 database), `bun run deploy` makes it.
    // adopt: the names below are used as written. Without it Alchemy picks random ones, and eqosys only accepts qview3d.<subdomain>.
    edge: { provider: "cloudflare", adopt: true, workerName: "qview3d" },
  },
});
