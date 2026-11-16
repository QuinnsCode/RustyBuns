import { defineConfig } from "@rustybuns/cli/config";

// The test swarm (#4758): a Worker and one Durable Object holding test jobs that our Macs lease, run and report,
// and the `typecheck` and `apps` commit statuses it posts once a SHA is green. Deploying is the owner's (MANUAL RUN).
export default defineConfig({
  name: "test-swarm",
  worker: {
    main: "src/worker.ts",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: [],
  },
  bindings: {
    // Every job, its lease and the statuses posted, in one object named "swarm".
    QUEUE: { type: "durable_object", className: "Queue" },
    // What our agents and runners send as a bearer token. Unset, every route answers 503.
    SWARM_TOKEN: { type: "secret", op: "op://test-swarm/swarm-token/password" },
    // A fine-grained token with "Commit statuses: write" on the repo below. Unset, the queue runs and posts nothing.
    GITHUB_STATUS_TOKEN: { type: "secret", op: "op://test-swarm/github-status-token/password", optional: true },
    GITHUB_REPO: { type: "var", value: "QuinnsCode/RustyBuns" },
  },
  experimental: { wheel: "human" },
  targets: { edge: { provider: "cloudflare", previewUrls: false } },
});
