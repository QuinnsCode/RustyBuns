import { expect, test } from "bun:test";
import type { RustyBunsConfig } from "../src/config.ts";
import { generateAlchemy } from "../src/gen/alchemy.ts";
import { adoptProblem, adoptQuestion } from "../src/isolation.ts";
import { realDestroyProblem } from "../src/environment.ts";
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
  // Another app's D1 is a ref into its stack: this destroy never touches it.
  const ref = protectReport({ bindings: { DB: { type: "d1", databaseName: "eqosys-db", app: "eqosys" } } }, "plan");
  expect(ref).toContain("[NOT OURS] D1 eqosys-db: eqosys owns it");
  expect(ref).not.toContain("[REMOVED]");
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

test("Durable Objects and Artifacts are reported REMOVED, and a production destroy is refused until --real", () => {
  const c = { bindings: { ROOM: { type: "durable_object", className: "Room" }, SHARED: { type: "durable_object", className: "X", scriptName: "other" }, REPOS: { type: "artifacts", namespace: "repos" } }, targets: {} } as unknown as RustyBunsConfig;
  const out = protectReport(c, "destroy");
  expect(out).toContain("[REMOVED] Durable Object Room");
  expect(out).toContain("[REMOVED] Artifacts repos");
  expect(out).not.toContain("X");
  expect(realDestroyProblem("destroy", c, "prod", false)).toContain("Durable Object Room, Artifacts repos");
  expect(realDestroyProblem("destroy", c, "prod", true)).toBeNull();
  expect(realDestroyProblem("destroy", c, "pr-5", false)).toBeNull();
});

test("protect on a Durable Object, a container or the worker keeps the Worker and every class in it (#3416)", () => {
  const base = { name: "chat", worker: { main: "src/index.ts" }, targets: { edge: { provider: "cloudflare" } } };
  const bindings = { ROOM: { type: "durable_object", className: "Room" }, BOX: { type: "container", className: "Box", dockerfile: "box/Dockerfile" } };
  const plain = { ...base, bindings } as unknown as RustyBunsConfig;
  expect(generateAlchemy(plain)).not.toContain("RemovalPolicy");
  for (const c of [
    { ...base, worker: { ...base.worker, protect: true }, bindings },
    { ...base, bindings: { ...bindings, ROOM: { ...bindings.ROOM, protect: true } } },
  ] as unknown as RustyBunsConfig[]) {
    expect(generateAlchemy(c)).toMatch(/^\}\)\.pipe\(Alchemy\.RemovalPolicy\.retain\(\)\);$/m);
    expect(protectedNames(c)).toEqual(["Worker chat", "Durable Object Room", "Durable Object Box"]);
    expect(protectReport(c, "destroy")).not.toContain("[REMOVED]");
    expect(realDestroyProblem("destroy", c, "prod", false)).toBeNull();
  }
  // A protected container keeps its application too, and under adopt the Worker takes both policies.
  const boxed = { ...base, targets: { edge: { provider: "cloudflare", adopt: true } }, bindings: { ...bindings, BOX: { ...bindings.BOX, protect: true } } } as unknown as RustyBunsConfig;
  const stack = generateAlchemy(boxed);
  expect(stack).toMatch(/export const BOX = \(Cloudflare\.Container\("BOX".*\)\)\.pipe\(Alchemy\.RemovalPolicy\.retain\(\)\);/);
  expect(stack).toContain(".pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain());");
  expect(protectedNames(boxed)).toContain("Container Box");
});
