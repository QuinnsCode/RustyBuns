import { defineConfig } from "@rustybuns/cli/config";

// One Worker. On the hour the cron starts a fight in the Arena Durable Object: two Clef
// decision models (Workers AI) draw the same prompt, a turn every 5 s for about four
// minutes, each one looking at its own canvas and picking a move. Finished fights go to
// R2, which is all the replays (and the Agent Office whiteboard) ever read.
//
// No secrets: Workers AI rides the account. Without the AI binding (local dev) fights
// are free practice on random answers.
export default defineConfig({
  name: "excalibrawl",
  worker: {
    main: "src/worker.tsx",
    builtMain: "dist/worker/index.js",
    assets: "dist/client",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    build: "bun run build",
    crons: ["0 * * * *"],
  },
  bindings: {
    // Clef and Clef Flash. Billed per input token, ~1,000 a call, so ~$0.02 a fight; no spend cap of its own, hence DAILY_CALLS.
    AI: { type: "ai" },
    ARENA: { type: "durable_object", className: "Arena" },
    // The arena's daily cap on Clef calls: a fight is 72, so 2,000 covers the 24 a day with room, ~$0.50 a day at worst.
    DAILY_CALLS: { type: "var", value: "2000" },
    ARCHIVE: { type: "r2", bucketName: "excalibrawl-replays" },
  },
  targets: {
    edge: { provider: "cloudflare" },
  },
});
