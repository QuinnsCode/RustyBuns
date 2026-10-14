import { expect, test } from "bun:test";
import type { RustyBunsConfig } from "../src/config.ts";
import { infraGraph, infraText } from "../src/infra.ts";

const cfg = {
  name: "shop",
  worker: { main: "src/index.ts", crons: ["0 * * * *"] },
  bindings: {
    DB: { type: "d1", databaseName: "shop-db" },
    INDEX: { type: "vectorize", indexName: "shop-index", dimensions: 768, protect: true },
    JOBS: { type: "queue", queueName: "shop-jobs", producer: false },
    PG: { type: "hyperdrive", origin: { neon: { project: "shop" } } },
    NAME: { type: "var", value: "x" },
    KEY: { type: "secret" },
  },
  targets: { edge: { provider: "cloudflare", domain: "shop.example.com", adopt: true } },
} as unknown as RustyBunsConfig;

test("the graph has the Worker, each resource binding, protect flags, and counts vars and secrets on the Worker", () => {
  const g = infraGraph(cfg, "prod");
  expect(g).toMatchObject({ app: "shop", stage: "prod", mode: "adopt", targets: ["edge"] });
  expect(g.nodes.map((n) => n.id)).toEqual(["worker", "DB", "INDEX", "JOBS", "PG", "PG:postgres"]);
  expect(g.nodes[0]!.note).toBe("shop.example.com · 1 cron · 1 var, 1 secret");
  expect(g.nodes.find((n) => n.id === "INDEX")).toMatchObject({ protected: true, name: "shop-index", note: "768 dimensions, cosine" });
  expect(g.nodes.find((n) => n.id === "DB")!.protected).toBe(false);
});

test("edges run from the Worker; a consumer-only queue points back at it; a Neon Hyperdrive reaches its Postgres", () => {
  const e = infraGraph(cfg, "prod").edges;
  expect(e).toContainEqual({ from: "worker", to: "DB" });
  expect(e).toContainEqual({ from: "JOBS", to: "worker", label: "consumer" });
  expect(e).toContainEqual({ from: "PG", to: "PG:postgres" });
});

test("the text form marks what destroy keeps and what it removes", () => {
  const t = infraText(infraGraph(cfg, "prod"));
  expect(t).toContain("[KEPT]    vectorize      INDEX (shop-index)");
  expect(t).toContain("[REMOVED] d1             DB (shop-db)");
});
