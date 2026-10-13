import { expect, test } from "bun:test";
import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Exit } from "effect";
import { decodeConfig } from "../src/config-schema.ts";

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
