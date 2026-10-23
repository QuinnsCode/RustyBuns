import { defineConfig } from "@rustybuns/cli/config";

// GeoBoxQ: one Worker, no database. The page and the Rust engine run in the browser; the Worker only
// serves them and hands the sealed engine's key to a paid license (src/seal.ts, apps/artstewengine).
//
// Secrets (see .env.schema): GEOBOXQ_LICENSE resolves through varlock. Unset, the sealed engine stays locked.
export default defineConfig({
  name: "geoboxq",
  worker: {
    main: "src/worker.ts",
    builtMain: "dist/geoboxq/index.js",
    assets: "dist/client",
    notFoundHandling: "single-page-application",
    runWorkerFirst: ["/api/*"],
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    build: "bun run build",
  },
  bindings: {
    GEOBOXQ_URL: { type: "var", value: "https://geoboxq.qntbr.com" },
    // The sealed engine asks artstewengine "have you paid?" with this license. Either unset: the engine stays locked.
    ARTSTEW_URL: { type: "var", value: "https://artstewengine.qntbr.com" },
    GEOBOXQ_LICENSE: { type: "secret", op: "op://qcrm/geoboxq/license", optional: true },
    // The shipper link (src/rates.ts): unset, /api/rates answers 501 "no aggregator linked".
    RATES_URL: { type: "secret", op: "op://qcrm/geoboxq/rates-url", optional: true },
    RATES_KEY: { type: "secret", op: "op://qcrm/geoboxq/rates-key", optional: true },
  },
  experimental: { wheel: "human" },
  targets: { edge: { provider: "cloudflare" } },
});
