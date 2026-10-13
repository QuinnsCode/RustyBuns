import { expect, test } from "bun:test";
import type { RustyBunsConfig } from "../src/config.ts";
import { generateAlchemy } from "../src/gen/alchemy.ts";
import { adoptProblem, adoptQuestion } from "../src/isolation.ts";
import { protectReport, protectedNames } from "../src/protect.ts";

const cfg = (adopt = false): RustyBunsConfig => ({
  name: "shop",
  worker: { main: "src/index.ts" },
  bindings: {
    DB: { type: "d1", databaseName: "shop-db" },
    INDEX: { type: "vectorize", indexName: "shop-index", dimensions: 768, protect: true },
    FILES: { type: "r2", bucketName: "shop-files", protect: true },
    NAME: { type: "var", value: "x" },
  },
  targets: { edge: { provider: "cloudflare", ...(adopt ? { adopt: true } : {}) } },
} as unknown as RustyBunsConfig);

test("a protected binding is decorated with RemovalPolicy.retain, and an unprotected one is not", () => {
  const stack = generateAlchemy(cfg());
  expect(stack).toMatch(/export const INDEX = \(Cloudflare\.Vectorize\.Index\("INDEX".*\)\)\.pipe\(Alchemy\.RemovalPolicy\.retain\(\)\);/);
  expect(stack).toMatch(/export const FILES = \(Cloudflare\.R2\.Bucket\("FILES"\)\)\.pipe\(Alchemy\.RemovalPolicy\.retain\(\)\);/);
  expect(stack).toMatch(/export const DB = Cloudflare\.D1\.Database\("DB"\);/);
});

test("the report says KEPT and REMOVED per resource, and nothing for a config with no data", () => {
  const out = protectReport(cfg(), "destroy");
  expect(out).toContain("[KEPT]    Vectorize shop-index");
  expect(out).toContain("[KEPT]    R2 shop-files");
  expect(out).toContain("[REMOVED] D1 shop-db");
  expect(protectReport({ bindings: { NAME: { type: "var", value: "x" } } }, "plan")).toBe("");
  expect(protectReport({ bindings: { DB: { type: "d1", databaseName: "db" } } }, "plan")).toContain("nothing is protected");
});

test("the plan and deploy report warns that protect counts from the next deploy; destroy's does not", () => {
  expect(protectReport(cfg(), "plan")).toContain("deploy before you destroy");
  expect(protectReport(cfg(), "destroy")).not.toContain("deploy before you destroy");
});

test("under ADOPT a destroy asks about what it deletes, and says what it keeps", () => {
  const c = cfg(true);
  expect(protectedNames(c)).toEqual(["Vectorize shop-index", "R2 shop-files"]);
  const q = adoptQuestion("destroy", c);
  expect(q).toContain("- D1 shop-db");
  expect(q).toContain("KEEPS these (protect: true):\n  - Vectorize shop-index");
  expect(q.split("KEEPS")[0]).not.toContain("shop-index");
  expect(adoptProblem("destroy", c, "/nonexistent", "dev", { fresh: false, adoptExisting: false })).not.toContain("shop-index");
});
