// The office's /__rb routes, behind its sign-in (http/router.js) and a worker's own token on the hook
// port (hooks/server.js), which is how the tools in tools.ts reach it:
//   GET  /__rb/mem              the office's and every floor's pty host's memory (live/mem.ts)
//   GET  /__rb/prof             the saved CPU profiles, newest first
//   POST /__rb/prof?s=10        profile the office for 10s, save it to <data>/prof, answer with its summary
//   GET  /__rb/prof/<id>        a saved profile's summary (?top=N frames)
//   GET  /__rb/heap             the heap snapshots the office and the pty hosts wrote over their ceiling
//   GET  /__rb/history          the office's runs, one per start, newest first: memory slope, profiles, ceiling restarts
//   GET  /__rb/context          Dexter's watch on live sessions' context size: `sessions` with each one's context, total used and latest turn (and `lines` of them, written out); `over` the warn lines now, and `fresh` crossings since the last ask (each once); `code` the sessions that ran a code-mode program since the last ask, with their code-mode, tool-load and direct MCP counts; `stalled` the sessions whose turn hung or went quiet owing work (#4306)
//   GET  /__rb/helpers          Ester's and Mervin's runs of the board script (ester/run.ts): phase, the tail they printed, PRs to hold,
//                               Mervin's running tally of conflicts avoided when one is kept (`tally`), and the release rings'
//                               lines from scripts/rings.ts (`rings`, read at most every 5 minutes) for Ester's card
//   GET  /__rb/line             the floor's open PRs and the ones merged in the last day (gh), for the gitpath screen (screens/)
//   GET  /__rb/reload           what the page is running and whether the server's code moved on (live/reload.ts)
//   POST /__rb/reload/restart   restart the office (SIGTERM; the workers keep running) when office:mama is minding it
//   POST /__rb/helpers/<name>   start one (ester, mervin or dexter) in the floor's repo that has its script, unless it is on it already.
//                               Ester with ?each=1 tests PR by PR (--check-stages) instead of the whole stack in one run; Mervin
//                               with ?keep=1 adds the run to his tally (<data>/mervin-tally.jsonl), which the person allows
// A POST from the page needs an X-RB-Triage header, which a form on another site can't send.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { cpuProfile, PROF_MAX_MS, profiling } from "@rustybuns/shell-bun/cpuprof";
import { listSaved, summarizeProfile } from "@rustybuns/shell-bun/profsummary";
import { historyRuns } from "@rustybuns/shell-bun/history";
import { officeHistory, officeMem } from "../live/mem.ts";
export { startReaper } from "../live/reaper.ts";
export { startCiLoop } from "../live/ci-loop.ts";
import { spread, spreadNow } from "../live/spread.ts";
export { startSpreadWatch } from "../live/spread.ts";
import { officeReload } from "../live/reload.ts";
import type { ContextReply } from "../live/replies.ts";
import { CARRY_ON, ContextWatch, Meter, ModeWatch, nameOf, sessionLines, StallWatch, type Context, type Stall } from "../ester/dexter.ts";
import { createHelpers, HELPERS, isHelper, repoWith, RINGS, ringsOf, type EsterState } from "../ester/run.ts";
import { mervinBoard, tallyRows, tallySum } from "../screens/read.ts";
import type { HelpersReply } from "../ester/state.ts";
import { lineOf, type Gh } from "../screens/line.ts";

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
  gh?: Gh,
) {
  const mem = officeMem(dataDir, floors);
  const hist = officeHistory(dataDir);
  const profDir = path.join(dataDir, "prof");
  const helpers = createHelpers();
  const tallyFile = path.join(dataDir, "mervin-tally.jsonl");
  const tally = () => (existsSync(tallyFile) ? tallySum(readFileSync(tallyFile, "utf8")) : null);
  const keep = (s: EsterState) => {
    if (s.phase !== "green" && s.phase !== "red") return;
    const rows = tallyRows(mervinBoard(s.lines), Date.now());
    if (rows.length) appendFileSync(tallyFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  };
  const lines = lineOf(gh);
  const rings = ringsOf();
  const context = new ContextWatch(), modes = new ModeWatch(), meter = new Meter(), stalls = new StallWatch();
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
    if (p === "/__rb/context") return method === "GET" ? { status: 200, body: (() => { const sessions = meter.scan(projects); const reply = { sessions: sessions.map((c) => ({ ...c, name: nameOf(c) })), lines: sessionLines(sessions), ...context.check(sessions), code: modes.check(sessions), stalled: stalls.check(sessions).stalled.map((x) => x.message) }; return reply satisfies ContextReply; })() } : only("GET");
    if (p === "/__rb/helpers") return method === "GET" ? { status: 200, body: { ester: helpers.ester.state(), mervin: helpers.mervin.state(), dexter: helpers.dexter.state(), tally: tally(), rings: rings(repoWith(RINGS, [...floors()].map((f) => f.dir))), spread: spread.lines() } satisfies HelpersReply } : only("GET");
    if (p === "/__rb/line") {
      if (method !== "GET") return only("GET");
      const dir = [...floors()][0]?.dir;
      return dir ? { status: 200, body: await lines(dir) } : { status: 404, body: { error: "No floor to read" } };
    }
    if (p.startsWith("/__rb/helpers/")) {
      const name = p.slice("/__rb/helpers/".length);
      if (!isHelper(name)) return { status: 404, body: { error: "Ester, Mervin or Dexter" } };
      if (method !== "POST") return only("POST");
      if (!trusted) return { status: 403, body: { error: `Send ${TRIAGE_HEADER}: 1 with the POST` } };
      if (name === "ester") void spreadNow(); // her badge also looks for tests failing on PR after PR (live/spread.ts)
      const dirs = [...floors()].map((f) => f.dir);
      if (!dirs.length) return { status: 404, body: { error: "No floor to run in" } };
      const repo = repoWith(HELPERS[name].script, dirs);
      if (!repo) return { status: 404, body: { error: `This helper works from ${HELPERS[name].script}, and none of the floors' repos have it (looked in ${dirs.join(", ")})` } };
      const args = name === "ester" && url.searchParams.get("each") === "1" ? ["--check-stages"] : HELPERS[name].args;
      const refused = helpers[name].start(repo, args, name === "mervin" && url.searchParams.get("keep") === "1" ? keep : undefined);
      return refused ? { status: refused.status, body: { error: refused.error } } : { status: 202, body: helpers[name].state() };
    }
    if (p === "/__rb/prof") {
      if (method === "GET") return { status: 200, body: { running: profiling(), profiles: listSaved(profDir, ".cpuprofile") } };
      if (method !== "POST") return only("GET or POST");
      if (!trusted) return { status: 403, body: { error: `Send ${TRIAGE_HEADER}: 1 with the POST` } };
      if (profiling()) return { status: 409, body: { error: "A profile is already being taken; try again when it's done" } };
      const ms = Math.min(Math.max(Math.round((Number(url.searchParams.get("s")) || 10) * 1000), 1000), PROF_MAX_MS);
      let taken: { file: string; json: string };
      try { taken = await cpuProfile({ dir: profDir, ms, name: "office" }); } catch (e) { return { status: 503, body: { error: `The profile failed: ${(e as Error).message}` } }; }
      const { file, json } = taken;
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

/** What watchStalls needs of a floor's workers (the office's WorkerManager): their rows, raw keys into one's terminal,
 * and typing a prompt into one, or waking it with one. */
export interface StallFloor {
  id: string;
  workers?: {
    list(): { id: string; name: string; worktree?: { path?: string }; pr?: unknown }[];
    write?(id: string, data: string, by?: string): void;
    prompt(id: string, text: string, by?: string): string | undefined;
    resume?(id: string, text: string): string | undefined;
  };
}

/** How long after the Escape that interrupts a hung turn the carry-on prompt is typed: Claude Code needs a moment to drop the request. */
export const INTERRUPT_MS = 1500;

/** The office worker a session is, by its worktree's folder name (.agent-office/worktrees/<name>). */
export function workerOf(c: Context, floors: Iterable<StallFloor>) {
  const dir = /\.agent-office\/worktrees\/([^/]+)/.exec(c.cwd)?.[1];
  if (!dir) return undefined;
  for (const floor of floors) for (const w of floor.workers?.list() ?? []) if (w.worktree?.path && path.basename(w.worktree.path) === dir) return { floor, w };
  return undefined;
}

/** One stall, acted on: a worker is told to carry on (woken with it if it stopped); any other session is named for a person.
 * A hung turn in a live process is interrupted first (Escape into its terminal, #4311): typed on its own, the prompt would
 * only queue behind the request that never returns. `later` runs the prompt once the interrupt has landed. */
export function carryOn(s: Stall, floors: Iterable<StallFloor>, toast: (floor: StallFloor | undefined, message: string) => void,
  later: (f: () => void) => void = (f) => void setTimeout(f, INTERRUPT_MS)) {
  const found = workerOf(s, floors);
  if (!found?.floor.workers) return toast(undefined, `${s.message} Nothing in the office types into that session: look at it.`);
  const { floor, w } = found, workers = found.floor.workers;
  if (s.kind === "quiet" && w.pr) return; // a worker with a PR linked is waiting on it, not owing work (#4306)
  const tell = (how: string) => {
    let err = workers.prompt(w.id, CARRY_ON, "the office");
    if (err === "Worker is not running" && workers.resume) [err, how] = [workers.resume(w.id, CARRY_ON), "Woke"];
    toast(floor, err ? `${s.message} Telling ${w.name} to carry on failed: ${err}` : `${s.message} ${how} ${w.name} to carry on.`);
  };
  if (s.kind !== "hung" || !workers.write) return tell("Told");
  workers.write(w.id, "\x1b", "the office"); // a dead process has no terminal: the write is dropped and the prompt below wakes it
  later(() => tell("Interrupted the hung request and told"));
}

/** Every `everyMs`, Dexter's stall watch over the live sessions (#4306): each new stall acted on once (carryOn). The office starts it once. */
export function watchStalls(floors: () => Iterable<StallFloor>, toast: (floor: StallFloor | undefined, message: string) => void, projects = path.join(homedir(), ".claude/projects"), everyMs = 60_000) {
  const meter = new Meter(), watch = new StallWatch();
  const tick = () => { try { for (const s of watch.check(meter.scan(projects)).fresh) carryOn(s, floors(), toast); } catch (e) { console.warn("[rb] stall watch:", (e as Error).message); } };
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
