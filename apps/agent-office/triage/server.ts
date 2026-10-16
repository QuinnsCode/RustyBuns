// The office's /__rb routes, behind its sign-in (http/router.js) and a worker's own token on the hook
// port (hooks/server.js), which is how the tools in tools.ts reach it:
//   GET  /__rb/mem              the office's and every floor's pty host's memory (live/mem.ts)
//   GET  /__rb/prof             the saved CPU profiles, newest first
//   POST /__rb/prof?s=10        profile the office for 10s, save it to <data>/prof, answer with its summary
//   GET  /__rb/prof/<id>        a saved profile's summary (?top=N frames)
//   GET  /__rb/heap             the heap snapshots the office and the pty hosts wrote over their ceiling
//   GET  /__rb/history          the office's runs, one per start, newest first: memory slope, profiles, ceiling restarts
//   GET  /__rb/context          Dexter's watch on live sessions' context size: `over` the warn line now, and `fresh` crossings since the last ask (each once)
//   GET  /__rb/helpers          Ester's and Mervin's runs of the board script (ester/run.ts): phase, the tail they printed, PRs to hold
//   GET  /__rb/reload           what the page is running and whether the server's code moved on (live/reload.ts)
//   POST /__rb/reload/restart   restart the office (SIGTERM; the workers keep running) when office:mama is minding it
//   POST /__rb/helpers/<name>   start one (ester, mervin or dexter) in the floor's repo that has its script, unless it is on it already
// A POST from the page needs an X-RB-Triage header, which a form on another site can't send.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { cpuProfile, PROF_MAX_MS, profiling } from "@rustybuns/shell-bun/cpuprof";
import { listSaved, summarizeProfile } from "@rustybuns/shell-bun/profsummary";
import { historyRuns } from "@rustybuns/shell-bun/history";
import { officeHistory, officeMem } from "../live/mem.ts";
import { officeReload } from "../live/reload.ts";
import { ContextWatch, contexts } from "../ester/dexter.ts";
import { createHelpers, HELPERS, isHelper, repoWith } from "../ester/run.ts";

export const TRIAGE_HEADER = "x-rb-triage";

/** Built into <office>/dist/server/server/rb-triage.js, so the page assets are two up, in dist/public. */
const SERVER_DIR = import.meta.dir;
const PUBLIC_DIR = path.resolve(SERVER_DIR, "../../public");
/** The workers' MCP server (triage/mcp.ts) is built beside bin/office-workers.js. */
const BIN_DIR = path.resolve(SERVER_DIR, "../../../bin");

export interface TriageAnswer { status: number; body: unknown }

const top = (url: URL) => Math.min(Math.max(Number(url.searchParams.get("top")) || 10, 1), 50);

/** The /__rb route handler; null for a path that isn't one of them. `trusted` lets a POST through. */
export function officeTriage(
  dataDir: string,
  floors: () => Iterable<{ id: string; dir: string }>,
  reload = officeReload(PUBLIC_DIR, SERVER_DIR, BIN_DIR, !!process.env.AGENT_OFFICE_RB_MAMA, () => process.kill(process.pid, "SIGTERM")),
  projects = path.join(homedir(), ".claude/projects"),
) {
  const mem = officeMem(dataDir, floors);
  const hist = officeHistory(dataDir);
  const profDir = path.join(dataDir, "prof");
  const helpers = createHelpers();
  const context = new ContextWatch();
  return async (method: string, url: URL, trusted: boolean): Promise<TriageAnswer | null> => {
    const p = url.pathname;
    const only = (m: string) => ({ status: 405, body: { error: `${m} ${p}` } });
    if (p === "/__rb/mem") return method === "GET" ? { status: 200, body: mem() } : only("GET");
    if (p === "/__rb/reload") return method === "GET" ? { status: 200, body: reload.state() } : only("GET");
    if (p === "/__rb/reload/restart") {
      if (method !== "POST") return only("POST");
      if (!trusted) return { status: 403, body: { error: `Send ${TRIAGE_HEADER}: 1 with the POST` } };
      return reload.restart() ? { status: 202, body: { restarting: true } } : { status: 409, body: { error: "Nothing restarts the office here: run bun run office:update, or start it with bun run office:mama" } };
    }
    if (p === "/__rb/history") return method === "GET" ? { status: 200, body: { runs: historyRuns(hist.read()) } } : only("GET");
    if (p === "/__rb/heap") {
      if (method !== "GET") return only("GET");
      const snapshots = [
        ...listSaved(path.join(dataDir, "heap"), ".heapsnapshot").map((f) => ({ process: "office", ...f })),
        ...[...floors()].flatMap((f) => listSaved(path.join(f.dir, ".agent-office", "heap"), ".heapsnapshot").map((s) => ({ process: `pty host (floor ${f.id})`, ...s }))),
      ].sort((a, b) => b.at.localeCompare(a.at));
      return { status: 200, body: { snapshots } };
    }
    if (p === "/__rb/context") return method === "GET" ? { status: 200, body: context.check(contexts(projects)) } : only("GET");
    if (p === "/__rb/helpers") return method === "GET" ? { status: 200, body: { ester: helpers.ester.state(), mervin: helpers.mervin.state(), dexter: helpers.dexter.state() } } : only("GET");
    if (p.startsWith("/__rb/helpers/")) {
      const name = p.slice("/__rb/helpers/".length);
      if (!isHelper(name)) return { status: 404, body: { error: "Ester, Mervin or Dexter" } };
      if (method !== "POST") return only("POST");
      if (!trusted) return { status: 403, body: { error: `Send ${TRIAGE_HEADER}: 1 with the POST` } };
      const dirs = [...floors()].map((f) => f.dir);
      if (!dirs.length) return { status: 404, body: { error: "No floor to run in" } };
      const repo = repoWith(HELPERS[name].script, dirs);
      if (!repo) return { status: 404, body: { error: `This helper works from ${HELPERS[name].script}, and none of the floors' repos have it (looked in ${dirs.join(", ")})` } };
      const refused = helpers[name].start(repo);
      return refused ? { status: refused.status, body: { error: refused.error } } : { status: 202, body: helpers[name].state() };
    }
    if (p === "/__rb/prof") {
      if (method === "GET") return { status: 200, body: { running: profiling(), profiles: listSaved(profDir, ".cpuprofile") } };
      if (method !== "POST") return only("GET or POST");
      if (!trusted) return { status: 403, body: { error: `Send ${TRIAGE_HEADER}: 1 with the POST` } };
      if (profiling()) return { status: 409, body: { error: "A profile is already being taken; try again when it's done" } };
      const ms = Math.min(Math.max(Math.round((Number(url.searchParams.get("s")) || 10) * 1000), 1000), PROF_MAX_MS);
      const { file, json } = await cpuProfile({ dir: profDir, ms, name: "office" });
      const profile = JSON.parse(json), id = path.basename(file);
      hist.profile(id, summarizeProfile(profile));
      return { status: 200, body: { id, file, seconds: ms / 1000, summary: summarizeProfile(profile, top(url)) } };
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
