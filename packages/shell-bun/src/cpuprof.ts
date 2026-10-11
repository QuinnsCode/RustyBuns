// CPU profiles from a running host. The V8-style sampling profiler (through
// node:inspector) runs for a fixed time and writes a .cpuprofile to the data
// dir: open it in Chrome DevTools > Performance, or drop it on speedscope.app,
// for a flame graph. A box exposes it at POST /__rb/prof behind a secret, since
// anyone who can start a profile can keep the box busy; with no secret the
// route doesn't exist. The memory watch also takes one before a ceiling restart.

import { Session } from "node:inspector";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { formatHistory, historyRuns, type History } from "./history.ts";
import { formatProfileSummary, summarizeProfile } from "./profsummary.ts";

export interface CpuProfileOptions {
  /** Where the .cpuprofile goes. */
  dir: string;
  /** How long to sample. @default 10s, at most 60s */
  ms?: number;
  /** Microseconds between samples. @default 1000 */
  intervalUs?: number;
  /** Profiles kept in `dir`; older ones are deleted. @default 10 */
  keep?: number;
  /** Name prefix. @default "cpu" */
  name?: string;
  /** Called once the profiler is sampling, before the wait starts. */
  onStart?: () => void;
}

export const PROF_MAX_MS = 60_000;
let busy = false;

/** True while a profile is being taken: one at a time per process. */
export const profiling = () => busy;

/** Samples the CPU for `ms`, writes `<dir>/<name>-<time>.cpuprofile` and returns its path and JSON. */
export async function cpuProfile(o: CpuProfileOptions): Promise<{ file: string; json: string }> {
  if (busy) throw new Error("a profile is already running");
  busy = true;
  const s = new Session();
  const post = (m: string, p: object = {}) => new Promise<any>((res, rej) => s.post(m, p, (e: any, r: any) => e ? rej(e) : res(r)));
  try {
    s.connect();
    await post("Profiler.enable");
    await post("Profiler.setSamplingInterval", { interval: o.intervalUs ?? 1000 });
    await post("Profiler.start");
    o.onStart?.();
    await Bun.sleep(Math.min(Math.max(o.ms ?? 10_000, 1), PROF_MAX_MS));
    const { profile } = await post("Profiler.stop");
    const json = JSON.stringify(profile);
    mkdirSync(o.dir, { recursive: true });
    const name = o.name ?? "cpu";
    const file = join(o.dir, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.cpuprofile`);
    writeFileSync(file, json);
    const old = readdirSync(o.dir).filter((f) => f.endsWith(".cpuprofile")).sort().reverse().slice(o.keep ?? 10);
    for (const f of old) rmSync(join(o.dir, f), { force: true });
    return { file, json };
  } finally {
    try { s.disconnect(); } catch {}
    busy = false;
  }
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The /__rb/prof route. Returns null when the request isn't for it, or when no
 * secret is set (shorter than 16 characters counts as unset), so the path falls
 * through to the app as if it weren't there. `POST /__rb/prof?s=10` with
 * `Authorization: Bearer <secret>` samples for 10 seconds, saves the profile to
 * `dir` and answers with it. With a `history`, each profile's summary goes into
 * it, and `GET /__rb/history`, behind the same secret, answers with its runs.
 * With `?text=1` both answer as text an agent can read (the profile's hottest
 * frames, `&top=N` of them; the newest `&runs=N` runs), for the box's WebMCP tools.
 */
export function profRoute(o: { secret?: string; dir: string; log?: (l: string) => void; history?: History }) {
  const secret = o.secret && o.secret.length >= 16 ? o.secret : "";
  const log = o.log ?? ((l) => console.log(l));
  if (o.secret && !secret) log("[prof] RB_PROF_SECRET is under 16 characters: /__rb/prof is off");
  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);
    const hist = url.pathname === "/__rb/history" && o.history;
    if (!secret || (url.pathname !== "/__rb/prof" && !hist)) return null;
    // X-RB-Prof tells the page's tools this answer is the box's, not the app's.
    const text = (body: string, status = 200, headers: Record<string, string> = {}) =>
      new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "X-RB-Prof": "1", ...headers } });
    const asText = url.searchParams.get("text") === "1";
    const n = (k: string, d: number) => Math.min(Math.max(Math.round(Number(url.searchParams.get(k))) || d, 1), 50);
    if (!same(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return text("unauthorized", 401);
    if (hist) {
      if (req.method !== "GET") return text("GET /__rb/history", 405, { Allow: "GET" });
      const runs = historyRuns(hist.read());
      return asText ? text(formatHistory(runs, n("runs", 5))) : Response.json({ runs });
    }
    if (req.method !== "POST") return text("POST /__rb/prof?s=<seconds>", 405, { Allow: "POST" });
    if (busy) return text("a profile is already running", 409);
    const ms = Math.round((Number(url.searchParams.get("s")) || 10) * 1000);
    log(`[prof] sampling ${Math.min(ms, PROF_MAX_MS) / 1000}s`);
    const { file, json } = await cpuProfile({ dir: o.dir, ms });
    log(`[prof] cpu profile ${file}`);
    const id = basename(file), profile = JSON.parse(json);
    o.history?.profile(id, summarizeProfile(profile));
    if (asText) return text(`${id} (sampled ${Math.min(ms, PROF_MAX_MS) / 1000}s)\n${formatProfileSummary(summarizeProfile(profile, n("top", 10)))}\n\n` +
      `saved on the box at ${file}; for a flame graph, \`rustybuns prof\` takes one and saves the .cpuprofile on your machine`);
    return new Response(json, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${file.split("/").at(-1)}"` } });
  };
}
