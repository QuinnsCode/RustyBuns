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
    // Clef, Clef Flash and the planner. Measured: a Clef turn ~$0.0005, a Flash turn ~$0.00003, a plan ~$0.0015, so
    // ~$0.016 a fight; Workers AI has no spend cap of its own, hence DAILY_CALLS.
    AI: { type: "ai" },
    ARENA: { type: "durable_object", className: "Arena" },
    // The arena's daily cap on model calls: a fight is 50 (24 turns a side and 2 plans), so 1,200 covers the 24 a
    // day; ~$0.60 a day at worst, if every call were Clef's.
    DAILY_CALLS: { type: "var", value: "1200" },
    ARCHIVE: { type: "r2", bucketName: "excalibrawl-replays" },
  },
  targets: {
    edge: { provider: "cloudflare" },
  },
});
