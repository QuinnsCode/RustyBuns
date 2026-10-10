// Deploy guards for a shared Alchemy state (#363).
//
// Every worktree of a repo deploys against one state (state.ts), so a deploy
// from a branch cut before main added a resource plans that resource as a
// `delete`. These two checks catch it before Alchemy runs: a live deploy from
// a HEAD that doesn't contain origin/main, and any deploy that would delete a
// resource holding data.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RustyBunsConfig } from "./config.ts";

/** Alchemy resource types that hold data, as their state files name them. */
const STATEFUL: Record<string, string> = {
  "Cloudflare.D1Database": "D1",
  "Cloudflare.R2.Bucket": "R2",
  "Cloudflare.R2Bucket": "R2",
  "Cloudflare.KV.Namespace": "KV",
  "Cloudflare.KVNamespace": "KV",
  "Cloudflare.Queues.Queue": "Queue",
  "Cloudflare.Container": "Container",
  "Hetzner.Volume": "Volume",
  "Railway.Volume": "Volume",
};

/**
 * How many commits of origin/main HEAD lacks, after fetching it. Null when
 * there is no origin/main to compare with (no git, no remote, offline with no
 * copy of it).
 */
export function commitsBehindMain(projectDir: string): number | null {
  const git = (...args: string[]) => Bun.spawnSync(["git", "-C", projectDir, ...args], { stdout: "pipe", stderr: "ignore" });
  // A failed fetch (offline) still leaves the last copy of origin/main to check against.
  git("fetch", "--quiet", "origin", "main");
  if (git("rev-parse", "--verify", "--quiet", "origin/main").exitCode !== 0) return null;
  const r = git("rev-list", "--count", "HEAD..origin/main");
  return r.exitCode === 0 ? Number(r.stdout.toString().trim()) : null;
}

/** Logical ids the generated stack declares: the first string argument of each resource call. */
export function declaredIds(stack: string): Set<string> {
  return new Set([...stack.matchAll(/\b(?:Cloudflare|Hetzner|Railway|Command)\.[\w.]+\("([^"]+)"/g)].map((m) => m[1]));
}

/**
 * Data-holding resources in this stage's state that the generated stack no
 * longer declares, so a deploy would delete them: R2, D1, KV, queues,
 * containers and volumes, plus Durable Object classes the Worker stops binding.
 */
export function statefulDeletes(projectDir: string, cfg: Pick<RustyBunsConfig, "name" | "bindings">, stage: string, stack: string): string[] {
  const dir = join(projectDir, ".alchemy", "state", cfg.name, stage);
  if (!existsSync(dir)) return [];
  const declared = declaredIds(stack);
  const read = (f: string) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return null; } };
  const out: string[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const s = read(f);
    const kind = s && STATEFUL[s.resourceType];
    if (!kind || declared.has(s.logicalId)) continue;
    const name = s.attr?.bucketName ?? s.attr?.databaseName ?? s.attr?.queueName ?? s.props?.name;
    out.push(`${kind} ${s.logicalId}${name && name !== s.logicalId ? ` (${name})` : ""}`);
  }
  const classes = new Set(Object.values(cfg.bindings ?? {}).flatMap((b) =>
    b.type === "durable_object" && !b.scriptName ? [b.className] : b.type === "container" ? [b.className] : []));
  for (const c of Object.keys(read("Worker.json")?.attr?.durableObjectNamespaces ?? {}))
    if (!classes.has(c)) out.push(`Durable Object class ${c}`);
  return out;
}
