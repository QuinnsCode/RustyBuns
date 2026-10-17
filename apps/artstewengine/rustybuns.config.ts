import { defineConfig } from "@rustybuns/cli/config";

// artstewengine: the one question qCRM's engine asks before it opens. Have you paid? No? Bye bye.
// It lives apart from qCRM on purpose, so cutting someone off never needs a change to code they hold.
//
// Secrets (see .env.schema): ENGINE_KEY unlocks the sealed engine; ADMIN_TOKEN guards /paid.
export default defineConfig({
  name: "artstewengine",
  worker: { main: "src/worker.ts", compatibilityDate: "2026-09-01", compatibilityFlags: [] },
  bindings: {
    // paid:<license> -> { who }, expiring when the payment does.
    PAYMENTS: { type: "kv" },
    ENGINE_KEY: { type: "secret", op: "op://qcrm/engine/key" },
    ADMIN_TOKEN: { type: "secret", op: "op://qcrm/engine/admin-token" },
  },
  targets: { edge: { provider: "cloudflare" } },
});
