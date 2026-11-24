// `rustybuns prof`: a CPU profile from the deployed box. The box answers
// POST /__rb/prof?s=N, behind RB_PROF_SECRET, with a .cpuprofile; this finds
// the box's URL in the stack's Alchemy state, sends the secret and saves the
// file under .rustybuns/prof/ for DevTools or speedscope. `rustybuns mem` reads
// the box's /__rb/mem, and `rustybuns history` its /__rb/history (same secret).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RustyBunsConfig } from "./config.ts";
import { sharedStateBase } from "./state.ts";
import { MemReply, type MemStats } from "@rustybuns/shell-bun/memwatch";
import { HistoryReply, type Run } from "@rustybuns/shell-bun/history";

export const PROF_SECRET = "RB_PROF_SECRET";

/** The box's URL from `<state>/<app>/<stage>/Service.json`, or null before a deploy. */
export function boxUrl(projectDir: string, cfg: Pick<RustyBunsConfig, "name" | "state">, stage: string): string | null {
  return stateUrl(projectDir, cfg, stage, "Service");
}

/** A resource's URL from `<state>/<app>/<stage>/<id>.json` ("Worker" or "Service"), or null before a deploy. */
export function stateUrl(projectDir: string, cfg: Pick<RustyBunsConfig, "name" | "state">, stage: string, id: string): string | null {
  const shared = cfg.state === "project" ? null : sharedStateBase(projectDir);
  const dir = shared ? join(shared, "state") : join(projectDir, ".alchemy", "state");
  const file = join(dir, cfg.name, stage, `${id}.json`);
  if (!existsSync(file)) return null;
  const url = JSON.parse(readFileSync(file, "utf8"))?.attr?.url;
  return typeof url === "string" && url ? url.replace(/\/$/, "") : null;
}

/** Why there's no secret to send, or null when there is one. */
export function secretProblem(cfg: RustyBunsConfig, secret: string | undefined): string | null {
  if (secret && secret.length >= 16) return null;
  if (secret) return `${PROF_SECRET} is under 16 characters, and the box ignores one that short.`;
  const declared = cfg.bindings?.[PROF_SECRET];
  return declared?.type === "secret"
    ? `${PROF_SECRET} has no value here. Set it in the shell or .dev.vars${cfg.experimental?.wheel ? ", or give the binding an op reference" : ""}: the same value the box was deployed with.`
    : `the box needs a ${PROF_SECRET} to profile. Add it to rustybuns.config.ts and deploy:\n` +
      `  bindings: { ${PROF_SECRET}: { type: "secret", boxOnly: true${cfg.experimental?.wheel ? `, op: "op://vault/item/field"` : ""} } }`;
}

/** POST /__rb/prof for `seconds`, save the profile, return its path. */
export async function fetchProfile(o: { url: string; secret: string; seconds: number; outDir: string; name: string; fetch?: typeof fetch }): Promise<string> {
  const f = o.fetch ?? fetch;
  const res = await f(`${o.url}/__rb/prof?s=${o.seconds}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${o.secret}` },
    signal: AbortSignal.timeout((o.seconds + 60) * 1000),
  });
  if (res.status === 401) throw new Error(`the box refused the secret: ${PROF_SECRET} here isn't the one it was deployed with.`);
  if (res.status === 409) throw new Error("the box is already taking a profile; try again when it's done.");
  if (res.status === 404 || !(res.headers.get("content-type") ?? "").includes("json"))
    throw new Error(`${o.url} has no /__rb/prof (status ${res.status}): the box has no ${PROF_SECRET}, or was built before \`rustybuns prof\`. Set it and deploy again.`);
  if (!res.ok) throw new Error(`/__rb/prof answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.text();
  mkdirSync(o.outDir, { recursive: true });
  const file = join(o.outDir, `${o.name}-${new Date().toISOString().replace(/[:.]/g, "-")}.cpuprofile`);
  writeFileSync(file, body);
  return file;
}

/** GET /__rb/mem: the box's memory, open to anyone like /health. */
export async function fetchMem(o: { url: string; fetch?: typeof fetch }): Promise<MemStats & { boots?: number }> {
  const res = await (o.fetch ?? fetch)(`${o.url}/__rb/mem`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json"))
    throw new Error(`${o.url} has no /__rb/mem (status ${res.status}): is it a RustyBuns box, built before the memory watch?`);
  return MemReply(await res.json());
}

/** GET /__rb/history, behind the same secret as /__rb/prof: the box's runs, newest first. */
export async function fetchHistory(o: { url: string; secret: string; fetch?: typeof fetch }): Promise<Run[]> {
  const res = await (o.fetch ?? fetch)(`${o.url}/__rb/history`, { headers: { Authorization: `Bearer ${o.secret}` }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 401) throw new Error(`the box refused the secret: ${PROF_SECRET} here isn't the one it was deployed with.`);
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json"))
    throw new Error(`${o.url} has no /__rb/history (status ${res.status}): the box has no ${PROF_SECRET}, or was built before \`rustybuns history\`. Set it and deploy again.`);
  return HistoryReply(await res.json()).runs;
}

/** The deployed Worker's script name: the state's `attr.name`, else the first label of its workers.dev URL. */
export function workerFromState(projectDir: string, cfg: Pick<RustyBunsConfig, "name" | "state">, stage: string): string | null {
  const shared = cfg.state === "project" ? null : sharedStateBase(projectDir);
  const file = join(shared ? join(shared, "state") : join(projectDir, ".alchemy", "state"), cfg.name, stage, "Worker.json");
  if (!existsSync(file)) return null;
  const s: unknown = JSON.parse(readFileSync(file, "utf8"));
  const attr = s && typeof s === "object" && "attr" in s ? s.attr : null;
  const name = attr && typeof attr === "object" && "name" in attr ? attr.name : null;
  if (typeof name === "string" && name) return name;
  const url = stateUrl(projectDir, cfg, stage, "Worker");
  const host = url ? new URL(url).hostname : "";
  return host.endsWith(".workers.dev") ? host.split(".")[0]! : null;
}

export interface EdgeProfile {
  worker: string;
  /** 1000 to 50000 (Cloudflare's limits). */
  ms: number;
  type: "cpu" | "heap";
  /** `latest-deployed`, a version id, or 8+ characters of one. */
  version: string;
  /** A Durable Object: its namespace id and the 64-hex object id. The Worker must be the one that owns the namespace. */
  object?: { namespace: string; actor: string };
}

/** The `cf` line for Cloudflare's on-demand profiler (developers.cloudflare.com/workers/observability/profiling-in-production/). */
export function edgeProfileArgs(p: EdgeProfile): string[] {
  return ["workers", "versions", "profile", p.version, "--worker", p.worker, "--duration-ms", String(p.ms), "--profile-type", p.type,
    ...(p.object ? ["--namespace-id", p.object.namespace, "--actor-id", p.object.actor] : [])];
}

/**
 * Capture a profile of the live Worker (or one Durable Object) with `cf`, save the pprof under
 * `outDir`, return its path. `cf` signs in on its own; the Worker must be taking traffic meanwhile,
 * since the profiler samples an isolate that's already running.
 */
export async function captureEdgeProfile(p: EdgeProfile & { outDir: string; cf?: string[] }): Promise<string> {
  const cf = p.cf ?? ["cf"];
  if (!p.cf && !Bun.which("cf")) throw new Error("rustybuns prof --edge runs Cloudflare's `cf` CLI, and it isn't on PATH. Install it and sign in: https://developers.cloudflare.com/cf/get-started/");
  mkdirSync(p.outDir, { recursive: true });
  const file = join(p.outDir, `${p.worker}${p.object ? "-do" : ""}-${p.type}-${new Date().toISOString().replace(/[:.]/g, "-")}.pprof`);
  const proc = Bun.spawn([...cf, ...edgeProfileArgs(p)], { stdout: Bun.file(file), stderr: "pipe" });
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) {
    rmSync(file, { force: true });
    const why = err.trim().split("\n").slice(-3).join("\n") || `exit ${code}`;
    const hint = /no recent executions|no loaded isolate/i.test(why) ? "\nthe profiler samples a running isolate: send the Worker traffic while it captures, and try again." : "";
    throw new Error(`cf couldn't profile ${p.worker}: ${why}${hint}`);
  }
  return file;
}
