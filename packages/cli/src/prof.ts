// `rustybuns prof`: a CPU profile from the deployed box. The box answers
// POST /__rb/prof?s=N, behind RB_PROF_SECRET, with a .cpuprofile; this finds
// the box's URL in the stack's Alchemy state, sends the secret and saves the
// file under .rustybuns/prof/ for DevTools or speedscope. `rustybuns mem` reads
// the box's /__rb/mem, and `rustybuns history` its /__rb/history (same secret).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RustyBunsConfig } from "./config.ts";
import { sharedStateBase } from "./state.ts";
import type { MemStats } from "@rustybuns/shell-bun/memwatch";
import type { Run } from "@rustybuns/shell-bun/history";

export const PROF_SECRET = "RB_PROF_SECRET";

/** The box's URL from `<state>/<app>/<stage>/Service.json`, or null before a deploy. */
export function boxUrl(projectDir: string, cfg: Pick<RustyBunsConfig, "name" | "state">, stage: string): string | null {
  const shared = cfg.state === "project" ? null : sharedStateBase(projectDir);
  const dir = shared ? join(shared, "state") : join(projectDir, ".alchemy", "state");
  const file = join(dir, cfg.name, stage, "Service.json");
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
  return res.json() as Promise<MemStats & { boots?: number }>;
}

/** GET /__rb/history, behind the same secret as /__rb/prof: the box's runs, newest first. */
export async function fetchHistory(o: { url: string; secret: string; fetch?: typeof fetch }): Promise<Run[]> {
  const res = await (o.fetch ?? fetch)(`${o.url}/__rb/history`, { headers: { Authorization: `Bearer ${o.secret}` }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 401) throw new Error(`the box refused the secret: ${PROF_SECRET} here isn't the one it was deployed with.`);
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json"))
    throw new Error(`${o.url} has no /__rb/history (status ${res.status}): the box has no ${PROF_SECRET}, or was built before \`rustybuns history\`. Set it and deploy again.`);
  return (await res.json() as { runs: Run[] }).runs;
}
