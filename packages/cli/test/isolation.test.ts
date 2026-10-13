import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RustyBunsConfig } from "../src/config.ts";
import { adoptProblem, adoptQuestion, adoptedNames, confirmAdopt, forceFresh, isolationFlags, modeLine } from "../src/isolation.ts";

const cfg = (adopt: boolean): RustyBunsConfig => ({
  name: "shop",
  bindings: {
    DB: { type: "d1", databaseName: "shop-db" },
    FILES: { type: "r2", bucketName: "shop-files" },
    JOBS: { type: "queue", queueName: "shop-jobs" },
    INDEX: { type: "vectorize", indexName: "shop-index", dimensions: 768 },
    NAME: { type: "var", value: "x" },
  },
  targets: { edge: { provider: "cloudflare", workerName: "shop-worker", ...(adopt ? { adopt: true } : {}) } },
} as unknown as RustyBunsConfig);

const none = { fresh: false, adoptExisting: false };

test("FRESH says nothing existing is touched, and lists no names", () => {
  expect(adoptedNames(cfg(false))).toEqual([]);
  expect(modeLine(cfg(false))).toContain("mode: FRESH");
  expect(modeLine(cfg(false))).toContain("Nothing that already exists");
  expect(modeLine(cfg(false), { forced: true })).toContain("(--fresh)");
  expect(modeLine(cfg(true), { offline: true })).toContain("FRESH (offline)");
});

test("ADOPT lists every name it would take over, the worker's too", () => {
  expect(adoptedNames(cfg(true))).toEqual(["Worker shop-worker", "D1 shop-db", "R2 shop-files", "Queue shop-jobs", "Vectorize shop-index"]);
  const line = modeLine(cfg(true));
  expect(line).toContain("mode: ADOPT");
  for (const n of ["shop-worker", "shop-db", "shop-files", "shop-jobs", "shop-index"]) expect(line).toContain(n);
});

test("--fresh turns adoption off, and leaves a fresh config as it was", () => {
  expect(adoptedNames(forceFresh(cfg(true)))).toEqual([]);
  const c = cfg(false);
  expect(forceFresh(c)).toBe(c);
  expect(isolationFlags(["--fresh", "--stage", "x"])).toEqual({ fresh: true, adoptExisting: false });
  expect(isolationFlags(["--adopt-existing"])).toEqual({ fresh: false, adoptExisting: true });
});

test("ADOPT refuses a first deploy and any destroy, until --adopt-existing", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-iso-"));
  expect(adoptProblem("deploy", cfg(true), dir, "dev", none)).toContain("never been deployed from here");
  expect(adoptProblem("destroy", cfg(true), dir, "dev", none)).toContain("a destroy deletes");
  expect(adoptProblem("deploy", cfg(true), dir, "dev", { ...none, adoptExisting: true })).toBeNull();
  expect(adoptProblem("destroy", cfg(true), dir, "dev", { ...none, adoptExisting: true })).toBeNull();
  // A stage already deployed from here is not a first deploy.
  mkdirSync(join(dir, ".alchemy", "state", "shop", "dev"), { recursive: true });
  writeFileSync(join(dir, ".alchemy", "state", "shop", "dev", "Worker.json"), "{}");
  expect(adoptProblem("deploy", cfg(true), dir, "dev", none)).toBeNull();
  // FRESH and plans never stop here.
  expect(adoptProblem("destroy", cfg(false), dir, "dev", none)).toBeNull();
  expect(adoptProblem("plan", cfg(true), dir, "other", none)).toBeNull();
});

test("the question names every resource, and only y or yes says yes", async () => {
  const q = adoptQuestion("deploy", cfg(true));
  for (const n of ["Worker shop-worker", "D1 shop-db", "R2 shop-files", "Queue shop-jobs"]) expect(q).toContain(n);
  expect(q).toContain("overwrite");
  expect(adoptQuestion("destroy", cfg(true))).toContain("DELETES");
  const answers = (...a: string[]) => { const rest = [...a]; return async () => rest.shift() ?? ""; };
  expect(await confirmAdopt(q, "shop-worker", answers("y", "shop-worker"))).toBe(true);
  expect(await confirmAdopt(q, "shop-worker", answers(" YES\n", " shop-worker\n"))).toBe(true);
  // Anything but y/yes, or a second answer that isn't the name, is no.
  for (const a of [[""], ["n"], ["yep"], ["no"], ["y"], ["y", ""], ["y", "y"], ["y", "SHOP-WORKER"], ["y", "shop"]])
    expect(await confirmAdopt(q, "shop-worker", answers(...a))).toBe(false);
});

test("with no terminal there is no one to ask, so it is a no", async () => {
  // bun test runs with no TTY on stdin
  if (process.stdin.isTTY) return;
  expect(await confirmAdopt("sure? ", "x")).toBe(false);
});
