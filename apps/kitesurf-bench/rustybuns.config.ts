import { defineConfig } from "@rustybuns/cli/config";

// Kitesurf bench: Kitesurf against Chromium on our own live pages, timed from inside a Worker.
// Deploy it, open it, press Run, copy the table, then destroy it: it exists to answer one question.
export default defineConfig({
  name: "kitesurf-bench",
  worker: {
    main: "src/worker.ts",
    compatibilityDate: "2026-11-01",
    compatibilityFlags: [],
  },
  bindings: { BROWSER: { type: "browser" } },
  targets: { edge: { provider: "cloudflare" } },
});
