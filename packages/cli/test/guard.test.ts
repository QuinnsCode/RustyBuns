import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitsBehindMain, declaredIds, statefulDeletes, strayState } from "../src/guard.ts";
import { generateAlchemy } from "../src/gen/alchemy.ts";
import type { RustyBunsConfig } from "../src/config.ts";

const sh = (cwd: string, ...cmd: string[]) => {
  const r = Bun.spawnSync(cmd, { cwd, stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
};
const commit = (cwd: string, msg: string) => sh(cwd, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", msg);

test("behind main: counts the commits of origin/main that HEAD lacks, after fetching", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rb-guard-")));
  const origin = join(root, "origin"), clone = join(root, "clone");
  mkdirSync(origin);
  sh(origin, "git", "init", "-q", "-b", "main");
  commit(origin, "one");
  sh(root, "git", "clone", "-q", origin, clone);
  expect(commitsBehindMain(clone)).toBe(0);

  // Main moves on after the branch was cut; the guard fetches to see it.
  sh(clone, "git", "checkout", "-q", "-b", "feature");
  commit(clone, "mine");
  commit(origin, "two");
  commit(origin, "three");
  expect(commitsBehindMain(clone)).toBe(2);

  sh(clone, "git", "-c", "user.name=t", "-c", "user.email=t@t", "rebase", "-q", "origin/main");
  expect(commitsBehindMain(clone)).toBe(0);

  const bare = join(root, "bare");
  mkdirSync(bare);
  sh(bare, "git", "init", "-q");
  expect(commitsBehindMain(bare)).toBeNull();
});

const cfg: RustyBunsConfig = {
  name: "game",
  worker: { main: "src/worker.ts", compatibilityDate: "2026-01-01", compatibilityFlags: [] },
  bindings: {
    DB: { type: "d1", databaseName: "game-db" },
    GAMES: { type: "durable_object", className: "GameRoom" },
  },
  targets: { edge: { provider: "cloudflare", adopt: true } },
} as RustyBunsConfig;

function stateDir(files: Record<string, unknown>) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rb-guard-state-")));
  const stage = join(dir, ".alchemy", "state", "game", "live_me");
  mkdirSync(stage, { recursive: true });
  for (const [f, v] of Object.entries(files)) writeFileSync(join(stage, f), JSON.stringify(v));
  return dir;
}

test("declared ids: every resource the generated stack makes, by logical id", () => {
  const ids = declaredIds(generateAlchemy({ ...cfg, bindings: { ...cfg.bindings, JOBS: { type: "queue", queueName: "game-jobs" } } } as RustyBunsConfig));
  for (const id of ["DB", "GAMES", "JOBS", "JOBSConsumer", "Worker"]) expect(ids.has(id)).toBe(true);
});

test("stateful deletes: a bucket main added and this branch lacks is named; Worker and build churn is not", () => {
  const dir = stateDir({
    "Worker.json": { logicalId: "Worker", resourceType: "Cloudflare.Worker", attr: { durableObjectNamespaces: { GameRoom: "a", OldRoom: "b" } } },
    "Build.json": { logicalId: "Build", resourceType: "Command.Build" },
    "DB.json": { logicalId: "DB", resourceType: "Cloudflare.D1Database", props: { name: "game-db" } },
    "LEVEL_CHUNKS.json": { logicalId: "LEVEL_CHUNKS", resourceType: "Cloudflare.R2.Bucket", attr: { bucketName: "game-level-chunks" } },
    "OLD_KV.json": { logicalId: "OLD_KV", resourceType: "Cloudflare.KVNamespace" },
    "HOOKSConsumer.json": { logicalId: "HOOKSConsumer", resourceType: "Cloudflare.Queues.Consumer" },
    "__stack_output__.json": { url: "https://game.example" },
  });
  const stack = generateAlchemy(cfg);
  expect(statefulDeletes(dir, cfg, "live_me", stack).sort()).toEqual([
    "Durable Object class OldRoom", "KV OLD_KV", "R2 LEVEL_CHUNKS (game-level-chunks)",
  ]);
  // Another stage, or no state yet: nothing to delete.
  expect(statefulDeletes(dir, cfg, "pr_1", stack)).toEqual([]);

  const withBucket = { ...cfg, bindings: { ...cfg.bindings, LEVEL_CHUNKS: { type: "r2", bucketName: "game-level-chunks" }, OLD_KV: { type: "kv" }, OLD: { type: "durable_object", className: "OldRoom" } } } as RustyBunsConfig;
  expect(statefulDeletes(dir, withBucket, "live_me", generateAlchemy(withBucket))).toEqual([]);
});

test("stateful deletes: renaming a database or queue replaces it, so it's named with its new name", () => {
  const dir = stateDir({
    "DB.json": { logicalId: "DB", resourceType: "Cloudflare.D1Database", attr: { databaseName: "game-db" } },
    "JOBS.json": { logicalId: "JOBS", resourceType: "Cloudflare.Queues.Queue", attr: { queueName: "game-jobs" } },
  });
  const was = { ...cfg, bindings: { ...cfg.bindings, JOBS: { type: "queue", queueName: "game-jobs" } } } as RustyBunsConfig;
  expect(statefulDeletes(dir, was, "live_me", generateAlchemy(was))).toEqual([]);
  const renamed = { ...cfg, bindings: { ...cfg.bindings, DB: { type: "d1", databaseName: "games-db" }, JOBS: { type: "queue", queueName: "games-jobs" } } } as RustyBunsConfig;
  expect(statefulDeletes(dir, renamed, "live_me", generateAlchemy(renamed)).sort()).toEqual([
    "D1 DB (game-db, renamed to games-db)", "Queue JOBS (game-jobs, renamed to games-jobs)",
  ]);
  // Without adopt the stack names nothing, so there's no rename to see.
  const unadopted = { ...renamed, targets: { edge: { provider: "cloudflare" } } } as RustyBunsConfig;
  expect(statefulDeletes(dir, unadopted, "live_me", generateAlchemy(unadopted))).toEqual([]);
});

test("stray state: a stage's state still under the app's old name is found", () => {
  const dir = stateDir({ "DB.json": { logicalId: "DB", resourceType: "Cloudflare.D1Database" } });
  expect(strayState(dir, "game", "live_me")).toBeNull();
  expect(strayState(dir, "games", "live_me")).toBe("game");
  expect(strayState(dir, "games", "pr_1")).toBeNull();
  expect(strayState(join(dir, "nowhere"), "games", "live_me")).toBeNull();
});
