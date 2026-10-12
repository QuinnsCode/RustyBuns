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
    `bindings.KV.type: "kvv" isn't one of d1, kv, r2, durable_object, artifacts, images, send_email, ratelimit, vectorize, ai, container, queue, var, secret`,
    "bindings.DB.databaseName: missing",
    `state: expected "shared" | "project", got "shard"`,
  ]);
  expect(await problems({ ...ok, worker: { compatibilityDate: "2026-06-01", compatibilityFlags: [], cpuMs: "50" } })).toEqual([`worker.cpuMs: expected number, got "50"`]);
  expect(await problems({ ...ok, extra: 1 })).toEqual(["extra: not a config key"]);
  expect(await problems({ ...ok, name: "My App", targets: { edge: { provider: "cloudflare" } } })).toHaveLength(1);
});
