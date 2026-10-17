import { defineConfig } from "@rustybuns/cli/config";

// boxFit: one Worker, no database. The page and the Rust engine run in the browser; the Worker only
// serves them and hands the sealed engine's key to a paid license (src/seal.ts, apps/artstewengine).
//
// Secrets (see .env.schema): BOXFIT_LICENSE resolves through varlock. Unset, the sealed engine stays locked.
export default defineConfig({
  name: "boxfit",
  worker: {
    main: "src/worker.ts",
    builtMain: "dist/boxfit/index.js",
    assets: "dist/client",
    notFoundHandling: "single-page-application",
    runWorkerFirst: ["/api/*"],
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    build: "bun run build",
  },
  bindings: {
    BOXFIT_URL: { type: "var", value: "https://boxfit.qntbr.com" },
    // The sealed engine asks artstewengine "have you paid?" with this license. Either unset: the engine stays locked.
    ARTSTEW_URL: { type: "var", value: "https://artstewengine.qntbr.com" },
    BOXFIT_LICENSE: { type: "secret", op: "op://qcrm/boxfit/license", optional: true },
  },
  experimental: { wheel: "human" },
  targets: { edge: { provider: "cloudflare" } },
});
