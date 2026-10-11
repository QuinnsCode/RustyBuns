import { defineConfig } from "@rustybuns/cli/config";

// Snack Vote: the small app the codeSplitters demo hands to agents. One Worker,
// no bindings, so `rustybuns deploy` (or codeSplitters' Deploy button) ships it as is.
export default defineConfig({
  name: "snack-vote",
  worker: {
    main: "src/worker.ts",
    compatibilityDate: "2026-06-01",
    compatibilityFlags: [],
  },
  bindings: {},
  targets: { edge: { provider: "cloudflare" } },
});
