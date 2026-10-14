import { expect, test } from "bun:test";
import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Exit } from "effect";
import { decodeConfig } from "../src/config-schema.ts";
import { forStage, type RustyBunsConfig } from "../src/config.ts";
import { generateAlchemy } from "../src/gen/alchemy.ts";

const apps = resolve(import.meta.dir, "../../../apps");
const configs = readdirSync(apps).map((a) => join(apps, a, "rustybuns.config.ts")).filter((f) => existsSync(f));

// Every config in the repo is a real one: the schema must take all of them, or it would
// reject apps that work (or one of them has a mistake nobody had caught).
test.each(configs.map((f) => [f.split("/apps/")[1]!, f]))("%s passes the schema", async (_, f) => {
  const exit = await Effect.runPromiseExit(decodeConfig((await import(f)).default));
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
});

const ok = { name: "demo", bindings: {}, targets: { desktop: {} } };
const problems = (c: unknown) =>
  Effect.runPromise(decodeConfig(c).pipe(Effect.match({ onFailure: (e) => e.problems, onSuccess: () => [] })));

test("names each field, every problem at once", async () => {
  expect(await problems(ok)).toEqual([]);
  expect(await problems({ ...ok, bindings: { KV: { type: "kvv" }, DB: { type: "d1" } }, state: "shard" })).toEqual([
    `bindings.KV.type: "kvv" isn't one of d1, kv, r2, durable_object, artifacts, images, send_email, ratelimit, vectorize, ai, container, queue, workflow, analytics_engine, worker_loader, hyperdrive, var, secret`,
    "bindings.DB.databaseName: missing",
    `state: expected "shared" | "project", got "shard"`,
  ]);
  expect(await problems({ ...ok, worker: { compatibilityDate: "2026-06-01", compatibilityFlags: [], cpuMs: "50" } })).toEqual([`worker.cpuMs: expected number, got "50"`]);
  expect(await problems({ ...ok, extra: 1 })).toEqual(["extra: not a config key"]);
  expect(await problems({ ...ok, targets: { box: { provider: "railway", persona: "background-burner" } } })).toEqual([]);
  expect(await problems({ ...ok, targets: { box: { provider: "railway", persona: "turbo" } } })).toHaveLength(1);
  expect(await problems({ ...ok, targets: { desktop: { mode: "spa", warm: 1 } } })).toEqual([]);
  expect(await problems({ ...ok, targets: { desktop: { mode: "spa", warm: -1 } } })).toHaveLength(1);
  expect(await problems({ ...ok, targets: { desktop: { mode: "spa", warm: 1.5 } } })).toHaveLength(1);
  expect(await problems({ ...ok, name: "My App", targets: { edge: { provider: "cloudflare" } } })).toHaveLength(1);
});

test("queue: a dead-letter queue is another queue binding", async () => {
  const q = (bindings: object) => problems({ ...ok, bindings });
  expect(await q({ JOBS: { type: "queue", queueName: "j", consumer: { deadLetterQueue: "DLQ" } }, DLQ: { type: "queue", queueName: "d", producer: false } })).toEqual([]);
  expect(await q({ JOBS: { type: "queue", queueName: "j", consumer: { deadLetterQueue: "j-dlq" } } }))
    .toEqual([`bindings.JOBS.consumer.deadLetterQueue: "j-dlq" isn't another queue binding; add j-dlq: { type: "queue", queueName: "...", producer: false, consumer: false }`]);
  expect(await q({ JOBS: { type: "queue", queueName: "j", consumer: { deadLetterQueue: "JOBS" } } })).toHaveLength(1);
  expect(await q({ JOBS: { type: "queue", queueName: "j", producer: true } })).toHaveLength(1);
});

test("hyperdrive: its urlSecret has to be a secret binding", async () => {
  const pg = (bindings: object) => problems({ ...ok, bindings });
  expect(await pg({ DATABASE_URL: { type: "secret" }, HYPERDRIVE: { type: "hyperdrive", urlSecret: "DATABASE_URL", caching: false } })).toEqual([]);
  expect(await pg({ HYPERDRIVE: { type: "hyperdrive", urlSecret: "DATABASE_URL" } }))
    .toEqual([`bindings.HYPERDRIVE.urlSecret: "DATABASE_URL" isn't a secret binding; add DATABASE_URL: { type: "secret" } with the postgres:// URL`]);
  expect(await pg({ DATABASE_URL: { type: "var", value: "postgres://x" }, HYPERDRIVE: { type: "hyperdrive", urlSecret: "DATABASE_URL" } })).toHaveLength(1);
  expect(await pg({ DATABASE_URL: { type: "secret" }, HYPERDRIVE: { type: "hyperdrive", urlSecret: "DATABASE_URL", caching: { maxAge: 0 } } })).toHaveLength(1);
  // origin.neon: the stack owns the database, so the URL secret is optional.
  expect(await pg({ HYPERDRIVE: { type: "hyperdrive", origin: { neon: { branch: "prod", pgVersion: 17 } } } })).toEqual([]);
  expect(await pg({ HYPERDRIVE: { type: "hyperdrive" } })).toEqual([`bindings.HYPERDRIVE: needs urlSecret (a secret with the postgres:// URL) or origin: { neon: {} }`]);
  expect(await pg({ HYPERDRIVE: { type: "hyperdrive", origin: { neon: { pgVersion: 13 } } } })).toHaveLength(1);
  expect(await pg({ DATABASE_URL: { type: "secret" }, HYPERDRIVE: { type: "hyperdrive", urlSecret: "DATABASE_URL", local: "pglite", migrationsDir: "drizzle" } })).toEqual([]);
  expect(await pg({ DATABASE_URL: { type: "secret" }, HYPERDRIVE: { type: "hyperdrive", urlSecret: "DATABASE_URL", migrationsDir: "drizzle" } }))
    .toEqual([`bindings.HYPERDRIVE.migrationsDir: only a PGlite twin takes migrations at boot; add local: "pglite", or migrate your Postgres yourself`]);
});

test("stages: each is laid over the config by --stage, and checked as it deploys (#1211)", async () => {
  const base: RustyBunsConfig = {
    name: "app",
    worker: { main: "src/worker.ts", compatibilityDate: "2026-06-01", compatibilityFlags: [], crons: ["0 * * * *"] },
    bindings: { DB: { type: "d1", databaseName: "app", migrationsDir: "db" }, MODE: { type: "var", value: "prod" } },
    targets: { edge: { provider: "cloudflare", adopt: true, domain: "app.example.com", previewUrls: false } },
    stages: { staging: { workerName: "app-staging", domain: [], crons: [], workersDev: false,
      bindings: { DB: { databaseName: "app-staging" }, MODE: { value: "staging" }, DEBUG: { type: "var", value: "1" } } } },
  };
  expect(await problems(base)).toEqual([]);
  const s = forStage(base, "staging");
  expect(s.stages).toBeUndefined();
  expect(s.bindings).toEqual({ DB: { type: "d1", databaseName: "app-staging", migrationsDir: "db" }, MODE: { type: "var", value: "staging" }, DEBUG: { type: "var", value: "1" } });
  expect(s.targets.edge).toEqual({ provider: "cloudflare", adopt: true, workerName: "app-staging", workersDev: false, previewUrls: false });
  expect(s.worker!.crons).toBeUndefined();
  // A stage with a Worker of its own doesn't inherit the live Worker's renamedFrom (it would take that one's data).
  const renamed = { ...base, targets: { edge: { ...base.targets.edge!, renamedFrom: "old-app" } } } as RustyBunsConfig;
  expect(forStage(renamed, "staging").targets.edge!.renamedFrom).toBeUndefined();
  expect(forStage(renamed, "prod").targets.edge!.renamedFrom).toBe("old-app");
  // A stage with no entry, or none asked for, is the config as written.
  expect(forStage(base, "prod")).toEqual({ ...base, stages: undefined } as never);
  const stack = generateAlchemy(s);
  expect(stack).toContain(`name: "app-staging"`);
  expect(stack).toContain(`workersDev: {"enabled":false,"previewsEnabled":false}`);
  expect(stack).not.toContain("app.example.com");
  expect(generateAlchemy(forStage(base, "prod"))).toContain(`name: "app",`);
  // Overrides are checked against what they make: a field on a binding the config lacks.
  expect(await problems({ ...base, stages: { qa: { bindings: { CACHE: { bucketName: "x" } } } } }))
    .toEqual([`stages.qa.bindings.CACHE: bindings has no CACHE for this to change; give it a type to add one in this stage`]);
  expect(await problems({ ...base, stages: { qa: { workerName: "Bad_Name" } } })).toHaveLength(1);
  expect(await problems({ ...base, stages: { "no good": {} } })).toHaveLength(1);
  expect(await problems({ ...base, targets: { edge: { provider: "cloudflare", accountId: "abc" } } })).toHaveLength(1);
});
