// The office's /__rb routes, behind its sign-in (http/router.js) and a worker's own token on the hook
// port (hooks/server.js), which is how the tools in tools.ts reach it:
//   GET  /__rb/mem              the office's and every floor's pty host's memory (live/mem.ts)
//   GET  /__rb/prof             the saved CPU profiles, newest first
//   POST /__rb/prof?s=10        profile the office for 10s, save it to <data>/prof, answer with its summary
//   GET  /__rb/prof/<id>        a saved profile's summary (?top=N frames)
//   GET  /__rb/heap             the heap snapshots the office and the pty hosts wrote over their ceiling
// A POST from the page needs an X-RB-Triage header, which a form on another site can't send.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cpuProfile, PROF_MAX_MS, profiling } from "@rustybuns/shell-bun/cpuprof";
import { listSaved, summarizeProfile } from "@rustybuns/shell-bun/profsummary";
import { officeMem } from "../live/mem.ts";

export const TRIAGE_HEADER = "x-rb-triage";

export interface TriageAnswer { status: number; body: unknown }

const top = (url: URL) => Math.min(Math.max(Number(url.searchParams.get("top")) || 10, 1), 50);

/** The /__rb route handler; null for a path that isn't one of them. `trusted` lets a POST through. */
export function officeTriage(dataDir: string, floors: () => Iterable<{ id: string; dir: string }>) {
  const mem = officeMem(dataDir, floors);
  const profDir = path.join(dataDir, "prof");
  return async (method: string, url: URL, trusted: boolean): Promise<TriageAnswer | null> => {
    const p = url.pathname;
    const only = (m: string) => ({ status: 405, body: { error: `${m} ${p}` } });
    if (p === "/__rb/mem") return method === "GET" ? { status: 200, body: mem() } : only("GET");
    if (p === "/__rb/heap") {
      if (method !== "GET") return only("GET");
      const snapshots = [
        ...listSaved(path.join(dataDir, "heap"), ".heapsnapshot").map((f) => ({ process: "office", ...f })),
        ...[...floors()].flatMap((f) => listSaved(path.join(f.dir, ".agent-office", "heap"), ".heapsnapshot").map((s) => ({ process: `pty host (floor ${f.id})`, ...s }))),
      ].sort((a, b) => b.at.localeCompare(a.at));
      return { status: 200, body: { snapshots } };
    }
    if (p === "/__rb/prof") {
      if (method === "GET") return { status: 200, body: { running: profiling(), profiles: listSaved(profDir, ".cpuprofile") } };
      if (method !== "POST") return only("GET or POST");
      if (!trusted) return { status: 403, body: { error: `Send ${TRIAGE_HEADER}: 1 with the POST` } };
      if (profiling()) return { status: 409, body: { error: "A profile is already being taken; try again when it's done" } };
      const ms = Math.min(Math.max(Math.round((Number(url.searchParams.get("s")) || 10) * 1000), 1000), PROF_MAX_MS);
      const { file, json } = await cpuProfile({ dir: profDir, ms, name: "office" });
      return { status: 200, body: { id: path.basename(file), file, seconds: ms / 1000, summary: summarizeProfile(JSON.parse(json), top(url)) } };
    }
    if (p.startsWith("/__rb/prof/")) {
      if (method !== "GET") return only("GET");
      const id = p.slice("/__rb/prof/".length);
      if (!/^[\w.-]+\.cpuprofile$/.test(id) || id.startsWith(".")) return { status: 400, body: { error: "id is a profile's file name, as list_profiles shows it" } };
      const file = path.join(profDir, id);
      if (!existsSync(file)) return { status: 404, body: { error: `No profile ${id} (the newest 10 are kept)` } };
      return { status: 200, body: { id, file, summary: summarizeProfile(JSON.parse(readFileSync(file, "utf8")), top(url)) } };
    }
    return null;
  };
}
