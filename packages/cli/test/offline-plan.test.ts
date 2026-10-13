import { test, expect } from "bun:test";
import { formatOfflinePlan, plannedResources } from "../src/offline-plan.ts";
import { generateAlchemy } from "../src/gen/alchemy.ts";
import type { RustyBunsConfig } from "../src/config.ts";

const cfg = {
  name: "game",
  worker: { main: "src/worker.ts", build: "vite build", compatibilityDate: "2026-01-01", compatibilityFlags: [] },
  bindings: {
    DB: { type: "d1", databaseName: "game-db" },
    JOBS: { type: "queue", queueName: "game-jobs" },
    GAMES: { type: "durable_object", className: "GameRoom" },
    AI: { type: "ai" },
    MODE: { type: "var", value: "x" },
  },
  targets: { edge: { provider: "cloudflare" } },
} as RustyBunsConfig;

test("offline plan: every resource the generated stack declares, bindings and Durable Objects marked", () => {
  const r = plannedResources(generateAlchemy(cfg));
  expect(r.map((x) => `${x.type} ${x.id}`)).toEqual([
    "Cloudflare.D1.Database DB",
    "Cloudflare.Queues.Queue JOBS",
    "Cloudflare.Workers.AI AI",
    "Command.Build Build",
    "Cloudflare.Worker Worker",
    "Cloudflare.DurableObject GAMES",
    "Cloudflare.Queues.Consumer JOBSConsumer",
  ]);
  expect(r.filter((x) => x.note).map((x) => `${x.id}: ${x.note}`)).toEqual(["AI: a binding, nothing to create", "GAMES: made with the Worker"]);
});

test("offline plan: a Railway box with a Neon branch lists both providers", () => {
  const r = plannedResources(generateAlchemy({
    name: "app",
    bindings: { DB: { type: "hyperdrive", origin: { neon: { branch: "prod" } } } },
    targets: { box: { provider: "railway", volume: true } },
  } as unknown as RustyBunsConfig));
  const ids = r.map((x) => x.id);
  for (const id of ["DBNeon", "DBNeonBranch", "Project", "Service", "Data"]) expect(ids).toContain(id);
});

test("offline plan: printed as creates, and says it isn't a plan for deploy", () => {
  const out = formatOfflinePlan("game", "dev_me", plannedResources(generateAlchemy(cfg)));
  expect(out).toContain("+ DB ");
  expect(out).toContain("~ AI ");
  expect(out).toContain("5 to create");
  expect(out).toContain("doesn't count as a plan");
});
