// Layout: the file page's Agent button: start a run, list runs
// Coding agents from the file page. The repo owner picks a harness (claude,
// codex, pi, opencode), types a task, and the agent runs on this machine with
// the CLI's own login, or in a container when AGENT_SANDBOX is bound (Cloudflare;
// see sandbox.ts). Its edit lands as line ops on the file, so every open page
// sees it live and blame says `agent-<harness>`.
//
// On this machine: desktop only, since the CLI runs as the machine's user and can
// run shell commands, so only the person whose machine it is may start one. In a
// container it can't reach the host, but it bills the site's keys, so accounts
// must be on: with aliases anyone can claim an admin's handle. Owner only either way.
// On GitHub it is the account its owner picked for agents (POST /api/github/agent), if any.
// Runs are kept in D1 (agent_runs), since on Cloudflare the next poll lands on
// another isolate. Either way a start answers at once (202): a local run goes on
// in this process, a container one rides the JOBS queue (runQueuedAgents), so a
// phone that drops the request doesn't drop the run.
//
//   GET  /api/agents                                     which harnesses this machine can run
//   POST /api/repos/:o/:r/agents {path, harness, task, model?, lines?}  start one; answers at once (202),
//        with `busy` when open branches already rewrite its file or files its task names (#1163).
//        With lines (ids), the run claims them: nobody else edits them till it's done.
//   GET  /api/repos/:o/:r/agents?path=                   this file's runs (the repo's without path), newest first (owner only)
//   POST /api/repos/:o/:r/agents/stop {ids?, path?, harness?, lines?}  stop the running ones that match all of these
//        (none: every one on the repo). Its CLI is killed or its container destroyed, and its claim lifted.
//   POST /api/repos/:o/:r/agents/:id/notes {text}         tell a running one something. A CLI can't take messages
//        while it runs, so the note goes into the prompt of its next run: when this one ends, it goes round again.
//   GET  /api/repos/:o/:r/agents/waiting?path=           this file's batches waiting on main, and lines that kept yours (anyone who reads it)
//   POST /api/repos/:o/:r/agents/:id/accept               land its waiting batch now (owner only)
//   POST /api/repos/:o/:r/agents/:id/hold                 stop its clock till someone accepts it (crew)
//   POST /api/repos/:o/:r/agents/:id/look                 someone's reading it: put the landing off a little (crew)
//   POST /api/repos/:o/:r/agents/:id/reject               throw it away (owner only)
//   GET  /api/repos/:o/:r/agents/engine                   the ENGINE lines rebuild tasks ended with, newest first (owner only, #1226)
//
// A run's batch doesn't land on main as it's written (#745). The agent works on a branch of its own,
// agent-run-<id>, and when it ends the batch waits there for AGENT_REVIEW_MS (8 seconds by default),
// shown on main's file page as a ghost diff with a countdown. Then it merges into main on its own (a
// JOBS message, delayed), unless someone said otherwise: look puts the landing off while they read it,
// hold stops the clock till they accept, accept lands it now, reject throws it away. A line someone
// changed on main meanwhile keeps their version, and the run's `kept` says what the agent wanted there.
// A batch that touches build or deploy files, or that the repo's required checks hold, waits for an accept.
// AGENT_REVIEW_MS=0 writes main directly, as the agent goes.
//
// A run has a budget, from its path's policy (#1077, budget.ts): past it, failing the same way twice
// or about to start a third conflict round, it stops, and leaves a caveman-terse note (DONE, NEXT,
// BROKE, DONT). Then, as the policy says: `handoff` starts a fresh agent from the note and nothing
// else, `downshift` does on the cheapest model, and `escalate` leaves it to a person. A fresh agent
// works on the branch the stopped one left, whose batch waits, held, till it's done; after HANDOFFS
// of them it's a person's turn. The run says how much it read (`spent`) and, under `handoff`, why it stopped.

import { parseJson } from "./util.ts";
import { protectOn } from "./protect.ts";
import { json, type Env, readBody } from "./env.ts";
import { byToken } from "./tokens.ts";
import { charge, every, SITE } from "./limits.ts";
import { accountsOn, actingAs, isAdmin } from "./identity.ts";
import { HARNESSES, HOSTED_HARNESSES, RUNS_COMMANDS, harnessCommand, type Harness } from "./harness.ts";
import { Interrupted, localSandbox, runAgent, type Conflict, type Exec, type Sandbox } from "./agent-run.ts";
import { containerSandbox, LOGINS } from "./sandbox.ts";
import { agentGithubToken } from "./github.ts";
import { toFile } from "./archive.ts";
import { text, type Doc } from "./lines.ts";
import { policyOf, type Over, type Policy } from "./policy.ts";
import { HANDOFFS, handoffTask, noteFor, short } from "./budget.ts";
import { cheapest } from "./conflict-agent.ts";
import { dispatchHint } from "./branches.ts";
import type { Busy } from "./merge-plan.ts";
import { MERVIN } from "./mervin.ts";
import { readStats } from "./stats.ts";
import { engineLines, type Engine } from "./heal.ts";
import { isBuildFile } from "./buildfiles.ts";

export interface Run {
  id: number;
  owner: string; repo: string; path: string;
  harness: Harness; task: string;
  /** The collaborator the edit is blamed on. */
  agent: string;
  status: "running" | "done" | "failed" | "stopped";
  started: number;
  log: string[];
  applied?: number; rev?: number; runs?: number;
  conflicts?: Conflict[];
  /** Whether it ran with the GitHub its owner picked for agents. */
  github?: boolean;
  output?: string;
  error?: string;
  /** When a hosted run is cut off: the queue consumer's 15 minutes. A local run has none. */
  deadline?: number;
  /** The lines it was given and claimed, if any. */
  lines?: string[];
  /** What its owner told it while it ran, oldest first. */
  notes: Note[];
  /** Its batch, waiting on its own branch to land on main. `until` null: held till someone accepts it (`why`, when it wasn't a person). */
  pending?: { branch: string; until: number | null; why?: string };
  /** When its batch landed on main, and who landed it ("auto": nobody stopped the clock). */
  landed?: { at: number; by: string };
  /** Lines someone changed on main while the batch waited: theirs stayed, and this is what the agent wanted. */
  kept?: { line: string; yours: string | null; wanted: string | null }[];
  /** Its batch was thrown away. */
  rejected?: { at: number; by: string };
  /** A fix task (heal.ts): it edits this open branch itself, and nothing of it lands on main. */
  branch?: string;
  /** A fix task's other files of the branch, beside `path`, that it may edit; and those it did. */
  also?: string[];
  edited?: string[];
  /** A rebuild task (#1219): the branch whose merge it rebuilds this one on. When it ends, the branch goes upstream (`pushed`, #1226). */
  rebuild?: string;
  pushed?: { ok: boolean; error?: string };
  /** A rebuild task's ENGINE lines (heal.ts engineLines): per clash, whether a merge rule could have settled it. */
  engine?: Engine[];
  /** About how many tokens it read and wrote (budget.ts). */
  spent?: number;
  /** It stopped short of its budget (#1077): at how many tokens, why, its note, and who took over: run `next`, or a person. */
  handoff?: { at: number; why: string; over: Over; note: string; next?: number };
  /** It took over from run `from`, its task that run's note; `hops` handoffs into the task. */
  from?: number; hops?: number;
  /** Times an update cut the run off and it started again from the file as it stood (at most MAX_RESTARTS), and when a hosted run last said it was alive. */
  restarts?: number; beat?: number;
  /** How far the last round got: how many times the agent ran, the edits it had landed and the tokens it spent. */
  progress?: { runs: number; applied: number; spent: number };
  /** On the start's answer only (#1163): open branches already rewriting its file or the ones its task names. */
  busy?: Busy[];
}

export interface Note { text: string; at: number }

/** A queue consumer's wall time, so a hosted run's limit. */
const HOSTED_RUN_MS = 15 * 60_000;
/** Feature runs at once in containers: AGENT_SANDBOX has 2, and the other is for fix and rebuild tasks (#1242). */
const HOSTED_FEATURE_SLOTS = 1;
const HELD_RETRY_S = 20;
/** How long past its deadline a hosted run may still be `running` before a listing calls it cut off. */
const HOSTED_GRACE_MS = 2 * 60_000;
/** How many runs each repo keeps. */
const KEEP = 50;
/** Times a run starts over after an update cut it off, before it is left failed. */
const MAX_RESTARTS = 2;
/** How often a hosted run says it is alive (`beat`), and how long without one means its consumer is gone (a deploy, a crash). */
const BEAT_MS = 20_000;
const DEAD_MS = 75_000;
/** How long a cut-off run waits before it goes round again, so the new build is up. */
const RESTART_S = 10;
/** How many of a run's log lines are kept. */
const LOG_LINES = 50;
/** How often a run looks for a Stop or a note in D1: a hosted one's Stop lands on another isolate. */
const CHECK_MS = 2000;
/** Notes a run takes, and how long each may be. */
const NOTES = 20, NOTE_CHARS = 2000;
/** How long a finished run's batch waits on main before it lands; 0: none, the agent writes main itself. */
export const reviewMs = (env: Env) => { const n = Number(env.AGENT_REVIEW_MS ?? 8000); return Number.isFinite(n) && n >= 0 ? n : 8000; };
/** Looking at a waiting batch puts its landing off till this long after the last look. */
const LOOK_MS = 6000;
const REVIEWS = ["accept", "hold", "look", "reject"];
/** The branch a run's batch waits on. */
export const runBranch = (id: number) => `agent-run-${id}`;

interface Row { id: number; owner: string; repo: string; path: string; harness: Harness; task: string; model: string | null; agent: string; status: Run["status"]; started: number; picked: number; log: string; result: string | null; notes: string; branch?: string | null }

const toRun = (r: Row, env: Env): Run => ({ ...(env.AGENT_SANDBOX ? { deadline: r.started + HOSTED_RUN_MS } : {}), ...(r.branch ? { branch: r.branch } : {}), id: r.id, owner: r.owner, repo: r.repo, path: r.path, harness: r.harness, task: r.task, agent: r.agent, status: r.status, started: r.started, log: JSON.parse(r.log), notes: JSON.parse(r.notes ?? "[]"), ...(r.result ? JSON.parse(r.result) : {}) });
const getRow = (env: Env, id: number) => env.DB.prepare("SELECT * FROM agent_runs WHERE id = ?").bind(id).first() as Promise<Row | null>;
/** Ends a run that's still going: one stopped meanwhile stays stopped. */
const finish = (env: Env, id: number, status: "done" | "failed", result: Partial<Run>) =>
  env.DB.prepare("UPDATE agent_runs SET status = ?, result = ? WHERE id = ? AND status = 'running'").bind(status, JSON.stringify(result), id).run();

/** A JOBS message that starts hosted run `agent` (or with `land`, lands its batch when its clock runs out); `origin` is the site's, for the agent's calls to the API. */
export interface AgentMessage { agent: number; origin: string; land?: true }

/** Calls the app as `who`, as the agent and its owner do. */
const caller = (self: (req: Request) => Promise<Response>, origin: string) => (who: string | null, path: string, init: RequestInit = {}) => {
  const r = new Request(origin + path, init);
  if (who) actingAs.set(r, who);
  return self(r);
};

// The desktop's runs going on in this process, each with its Stop: one still
// `running` in D1 that isn't here was cut off when the app quit.
// Kept per app instance: run ids restart at 1 in every database, so one shared map would hand a run another's stopper.
const lives = new WeakMap<object, Map<number, AbortController>>();
const liveOf = (env: Env) => { let m = lives.get(env); if (!m) lives.set(env, m = new Map()); return m; };

/** Why agents can't run here, or null when they can. Hosted ones need accounts on; local ones off, since the agent signs in by alias. */
export function agentsUnavailable(env: Env): string | null {
  if (env.AGENT_SANDBOX) return accountsOn(env) ? null : "Hosted agents need accounts on (BETTER_AUTH_SECRET): with aliases anyone can claim an admin's handle.";
  if (typeof Bun === "undefined") return "Coding agents run on the desktop app, where their CLIs are installed.";
  if (accountsOn(env)) return "Coding agents need the desktop app (accounts off).";
  return null;
}

/** Hosted runs (coding agents and feed digests) bill the site's own API keys, and
 *  anyone can sign up, so a per-person rate limit wouldn't cap the bill: only the
 *  handles in ADMINS may start one (#575). Off the hosted site, nothing is held back. */
export const adminsOnly = (env: Env, user: string | null) => !!env.AGENT_SANDBOX && !(env.ADMINS && isAdmin(env, user));
export const ADMINS_ONLY = "hosted agents are limited to this site's admins (ADMINS)";

/** A hosted run takes one from the site's daily budget (the `hosted` rule), admins' runs too: a 429 once it's spent. Off the hosted site, nothing is counted. */
export async function hostedBudget(env: Env): Promise<Response | null> {
  if (!env.AGENT_SANDBOX) return null;
  const over = await charge(env, "hosted", SITE);
  return over ? json({ error: over }, 429) : null;
}

/** `path`'s policy, from main's `.gitattributes` over the defaults, read as its owner. */
export async function policyFor(env: Env, owner: string, repo: string, path: string): Promise<Policy> {
  const res = await toFile(env, owner, repo, ".gitattributes", owner, "file").catch(() => null);
  return policyOf(path, res?.ok ? text(await res.json() as Doc) : "");
}

/** Why no agent edits `path`: `.gitattributes` locks it (a lockfile, or `codesplitter-live=locked`). */
const locked = (path: string) => `${path} is locked (codesplitter-live=locked): it's regenerated, so no agent edits it`;

/** The harnesses whose CLI is on PATH (all of them when a test swaps the CLI out; a hosted site's are HOSTED_HARNESSES). */
export const installedHarnesses = (env: Env) => env.AGENT_EXEC ? HARNESSES : env.AGENT_SANDBOX ? HOSTED_HARNESSES : HARNESSES.filter((h) => Bun.which(harnessCommand(h, "").bin));

export async function agentRoutes(req: Request, env: Env, p: string[], url: URL, user: string | null,
  access: (owner: string, repo: string) => Promise<{ read: boolean; write: boolean }>,
  self: (req: Request) => Promise<Response>): Promise<Response | null> {
  if (p[1] === "mervin" && !p[2] && req.method === "GET") return json(MERVIN);
  if (p[1] === "stats" && !p[2] && req.method === "GET") return json(await readStats(env), 200, { "cache-control": "public, max-age=30" });
  if (p[1] === "agents" && !p[2]) {
    const why = agentsUnavailable(env);
    return json({ available: !why, why, harnesses: why ? [] : installedHarnesses(env), all: HARNESSES, admins_only: adminsOnly(env, user) });
  }
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "agents")) return null;
  const [owner, repo] = [p[2], p[3]];
  const stop = p[5] === "stop" && !p[6], one = !!p[5] && /^\d+$/.test(p[5]) && !p[7];
  const note = one && p[6] === "notes", review = one && REVIEWS.includes(p[6] ?? ""), waiting = p[5] === "waiting" && !p[6];
  const engine = p[5] === "engine" && !p[6];
  if (p[5] && !stop && !note && !review && !waiting && !engine) return null;
  const a = await access(owner, repo);
  if (!a.read) return json({ error: "not found" }, 404);
  if (waiting) return req.method === "GET" ? waitingOn(env, self, url, owner, repo, user, a.write) : null;
  if (engine) {
    if (req.method !== "GET") return null;
    if (user !== owner) return json({ error: "only the repo's owner can see its coding agents" }, 403);
    return json(await engineSaid(env, owner, repo));
  }
  if (stop || note || review) {
    if (req.method !== "POST") return null;
    // The crew can put a batch off (look) or stop its clock (hold); landing or binning it is the owner's.
    const crewMay = review && (p[6] === "look" || p[6] === "hold");
    if (crewMay ? !a.write : user !== owner) return json({ error: crewMay ? "only the repo's crew can hold or look at an agent's batch" : "only the repo's owner can stop, tell, accept or reject its coding agents" }, 403);
    // An accept is a person reading the batch (it lands build files): a token can't give it.
    if (review && p[6] === "accept" && byToken(req)) return json({ error: "API tokens can't accept a batch: accept it on the site, signed in" }, 403);
    if (review) return reviewRun(env, self, url.origin, owner, repo, Number(p[5]), p[6]!, user!);
    return stop ? stopRuns(req, env, owner, repo, user!, caller(self, url.origin)) : tell(req, env, owner, repo, Number(p[5]));
  }

  if (req.method === "GET") {
    // A run's task and output can quote the repo's code and the agent's chatter,
    // so only the owner, who started them, sees them.
    if (user !== owner) return json({ error: "only the repo's owner can see its coding agents" }, 403);
    const path = url.searchParams.get("path");
    const { results } = await env.DB.prepare(`SELECT * FROM agent_runs WHERE owner = ? AND repo = ?${path ? " AND path = ?" : ""} ORDER BY id DESC LIMIT ${KEEP}`)
      .bind(...[owner, repo, path].filter((x) => x !== null)).all<Row>();
    const rows = results;
    if (!env.AGENT_SANDBOX) for (const r of rows) if (r.status === "running" && !liveOf(env).has(r.id)) {
      const error = "the app stopped before the agent finished";
      await finish(env, r.id, "failed", { error });
      Object.assign(r, { status: "failed", result: JSON.stringify({ error }) });
    }
    // A hosted run's own deadline timer lives in the consumer's isolate; if that went (a deploy, a crash), nothing else would end the row.
    if (env.AGENT_SANDBOX) for (const r of rows) if (r.status === "running" && r.started + HOSTED_RUN_MS + HOSTED_GRACE_MS < Date.now()) {
      const result = { error: `out of time: a hosted run gets ${every(HOSTED_RUN_MS / 1000)}` };
      await env.DB.prepare("UPDATE agent_runs SET status = 'stopped', result = json_set(COALESCE(result, '{}'), '$.error', ?) WHERE id = ? AND status = 'running'").bind(result.error, r.id).run();
      Object.assign(r, { status: "stopped", result: JSON.stringify({ ...resultOf(r), ...result }) });
    }
    // A hosted run whose consumer an update took (no beat for DEAD_MS) goes round again, or is left failed when it has been too often.
    if (env.AGENT_SANDBOX) for (const r of rows) if (r.status === "running" && r.picked && !alive(r)) {
      await interrupt(env, self, url.origin, r).catch(() => {});
      Object.assign(r, (await getRow(env, r.id)) ?? {});
    }
    await relaunch(env, rows, url.origin);
    return json(rows.map((r) => toRun(r, env)));
  }
  if (req.method !== "POST") return null;
  const why = agentsUnavailable(env);
  if (why) return json({ error: why }, 501);
  if (user !== owner) return json({ error: "only the repo's owner can start a coding agent" }, 403);
  if (adminsOnly(env, user)) return json({ error: ADMINS_ONLY }, 403);
  const { path, harness: h, task, model, lines } = await readBody<"path" | "harness" | "task" | "model" | "lines">(req);
  if (lines !== undefined && !(Array.isArray(lines) && lines.every((l): l is string => typeof l === "string"))) return json({ error: "lines: line ids" }, 400);
  if (typeof path !== "string" || !path) return json({ error: "path required" }, 400);
  const harness = HARNESSES.find((x) => x === h);
  if (!harness) return json({ error: `harness: ${HARNESSES.join(", ")}` }, 400);
  if (!installedHarnesses(env).includes(harness)) return json({ error: `${harness} isn't installed on this machine` }, 400);
  if (typeof task !== "string" || !task.trim()) return json({ error: "task required" }, 400);
  if (model !== undefined && model !== null && typeof model !== "string") return json({ error: "model: text" }, 400);
  // A locked path is regenerated, never edited live: refused before a container starts or a token is spent.
  if ((await policyFor(env, owner, repo, path)).live === "locked") return json({ error: locked(path) }, 409);
  const spent = await hostedBudget(env);
  if (spent) return spent;

  // The agent edits as its own collaborator, so blame shows which agent wrote what.
  const agent = `agent-${harness}`, origin = url.origin, call = caller(self, origin);
  const added = await call(owner, `/api/repos/${owner}/${repo}/collaborators`, { method: "POST", body: JSON.stringify({ name: agent }) });
  if (!added.ok) return json({ error: `adding ${agent}: ${await added.text()}` }, 500);

  const model_ = model?.trim() || null;
  // The lines ride in the result until the run's own result replaces them.
  const row = await env.DB.prepare("INSERT INTO agent_runs (owner, repo, path, harness, task, model, agent, status, started, result) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?) RETURNING *")
    .bind(owner, repo, path, harness, task.trim().slice(0, 2000), model_, agent, Date.now(), lines?.length ? JSON.stringify({ lines: lines.slice(0, 5000) }) : null).first() as Row;
  await env.DB.prepare(`DELETE FROM agent_runs WHERE owner = ? AND repo = ? AND id NOT IN (SELECT id FROM agent_runs WHERE owner = ? AND repo = ? ORDER BY id DESC LIMIT ${KEEP})`)
    .bind(owner, repo, owner, repo).run();
  // Heads up if an open branch is already rewriting its files: its batch will likely meet that one at merge.
  const { busy } = await dispatchHint(env, owner, repo, task, [path]).catch(() => ({ busy: [] }));
  await launch(env, self, origin, row.id);
  return json({ ...toRun(row, env), ...(busy.length ? { busy } : {}) }, 202);
}

/** Starts run `id`: off the queue when hosted, in this process on the desktop. */
async function launch(env: Env, self: (req: Request) => Promise<Response>, origin: string, id: number) {
  if (env.AGENT_SANDBOX) await env.JOBS.send({ agent: id, origin });
  else { liveOf(env).set(id, new AbortController()); void execute(env, self, origin, id).finally(() => liveOf(env).delete(id)); }
}

/** Stops the repo's running runs that match every filter given (none: all of them). */
async function stopRuns(req: Request, env: Env, owner: string, repo: string, user: string, call: ReturnType<typeof caller>) {
  const { ids, path, harness, lines } = await readBody<"ids" | "path" | "harness" | "lines">(req);
  if (ids !== undefined && !(Array.isArray(ids) && ids.every((i): i is number => Number.isInteger(i)))) return json({ error: "ids: run ids" }, 400);
  if (lines !== undefined && !(Array.isArray(lines) && lines.every((l): l is string => typeof l === "string"))) return json({ error: "lines: line ids" }, 400);
  const { results } = await env.DB.prepare("SELECT * FROM agent_runs WHERE owner = ? AND repo = ? AND status = 'running'").bind(owner, repo).all<Row>();
  const want = lines && new Set(lines);
  const hit = results.filter((r) => {
    const claimed = parseJson<Partial<Run>>(r.result, {}).lines;
    return (!ids || ids.includes(r.id)) && (!path || r.path === path) && (!harness || r.harness === harness)
      // On lines: the runs that claimed any of them. One given no lines works on the whole file, so it's left be.
      && (!want || !!claimed?.some((l) => want.has(l)));
  });
  const stopped: number[] = [];
  for (const r of hit) {
    const result = { ...(r.result ? JSON.parse(r.result) : {}), error: `stopped by @${user}` };
    const done = await env.DB.prepare("UPDATE agent_runs SET status = 'stopped', result = ? WHERE id = ? AND status = 'running'").bind(JSON.stringify(result), r.id).run();
    if (!done.meta?.changes) continue;
    stopped.push(r.id);
    // Here it stops at once; a hosted run sees it on its next check.
    liveOf(env).get(r.id)?.abort();
    // Its lines are free now, even if the run itself is gone (cut off, or the app quit).
    if (result.lines) await call(owner, `/api/repos/${owner}/${repo}/do/claims?path=${encodeURIComponent(r.path)}`, { method: "POST", body: JSON.stringify({ id: `run-${r.id}`, release: true }) }).catch(() => {});
  }
  return json({ stopped });
}

/** Leaves a note for running run `id`, which its next run's prompt carries. */
async function tell(req: Request, env: Env, owner: string, repo: string, id: number) {
  const { text } = await readBody<"text">(req);
  if (typeof text !== "string" || !text.trim()) return json({ error: "text required" }, 400);
  const row = await getRow(env, id);
  if (!row || row.owner !== owner || row.repo !== repo) return json({ error: "no such run" }, 404);
  const add = JSON.stringify({ text: text.trim().slice(0, NOTE_CHARS), at: Date.now() });
  // One statement, so two notes at once both land.
  const done = await env.DB.prepare(`UPDATE agent_runs SET notes = json_insert(notes, '$[#]', json(?)) WHERE id = ? AND status = 'running' AND json_array_length(notes) < ${NOTES}`).bind(add, id).run();
  if (!done.meta?.changes) return json({ error: row.status === "running" ? `a run takes ${NOTES} notes at most` : `this run is ${row.status}: start a new one with what you'd tell it` }, 409);
  return json(toRun((await getRow(env, id))!, env));
}

/** The JOBS queue's agent messages (worker.ts): each hosted run, side by side, since one can take minutes; and batches whose clock ran out. */
export async function runQueuedAgents(messages: readonly { body: AgentMessage; ack(): void }[], env: Env, self: (req: Request) => Promise<Response>) {
  await Promise.all(messages.map(async (m) => {
    if (m.body.land) await landDue(env, self, m.body.origin, m.body.agent).catch(() => {});
    else if (await execute(env, self, m.body.origin, m.body.agent) === "held") await env.JOBS.send(m.body, { delaySeconds: HELD_RETRY_S });
    m.ack();
  }));
}

const resultOf = (r: Row | null): Partial<Run> => r?.result ? JSON.parse(r.result) : {};

/** A batch whose landing was lost (the app quit with it queued) goes round again. */
async function relaunch(env: Env, rows: Row[], origin: string) {
  for (const r of rows) {
    const p = resultOf(r).pending;
    if (p?.until != null && p.until < Date.now() - 5000) await landLater(env, r.id, origin, 0);
  }
}

/** A batch waiting on main, as anyone who reads the file sees it: no task, log or output, which can quote the agent's chatter. */
export interface Waiting { id: number; agent: string; started: number; pending: NonNullable<Run["pending"]>; hunks: unknown[] }

/**
 * Path's batches waiting on main (#757), each with its branch's hunks (private lines blank
 * outside the crew, as the hunks route has them), and for the crew the lines a landing in
 * the last day kept theirs on, with what the agent wanted.
 */
async function waitingOn(env: Env, self: (req: Request) => Promise<Response>, url: URL, owner: string, repo: string, user: string | null, crew: boolean) {
  const path = url.searchParams.get("path");
  if (!path) return json({ error: "path is required" }, 400);
  const { results } = await env.DB.prepare(`SELECT * FROM agent_runs WHERE owner = ? AND repo = ? AND path = ? ORDER BY id DESC LIMIT ${KEEP}`).bind(owner, repo, path).all<Row>();
  const rows = results, day = Date.now() - 86_400_000;
  const call = caller(self, url.origin);
  const waiting: Waiting[] = await Promise.all(rows.flatMap((r) => {
    const p = resultOf(r).pending;
    return p ? [(async () => {
      const res = await call(user, `/api/repos/${owner}/${repo}/branches/${encodeURIComponent(p.branch)}/hunks?path=${encodeURIComponent(path)}`);
      return { id: r.id, agent: r.agent, started: r.started, pending: p, hunks: res.ok ? ((await res.json()) as { hunks: unknown[] }).hunks : [] };
    })()] : [];
  }));
  const kept = crew ? rows.flatMap((r) => { const x = resultOf(r); return x.landed && x.landed.at > day ? (x.kept ?? []).map((k) => ({ ...k, agent: r.agent })) : []; }) : [];
  return json({ waiting, kept });
}
const landLater = (env: Env, id: number, origin: string, ms: number) => env.JOBS.send({ agent: id, origin, land: true }, { delaySeconds: Math.max(0, Math.ceil(ms / 1000)) });
/** Sets a run's result if its batch is still waiting as `was` read it; false if something else got there first. */
const swap = async (env: Env, id: number, was: Partial<Run>, now: Partial<Run>) =>
  !!(await env.DB.prepare("UPDATE agent_runs SET result = ? WHERE id = ? AND json_extract(result, '$.pending') = json(?)")
    .bind(JSON.stringify(now), id, JSON.stringify(was.pending)).run()).meta?.changes;

/** A batch's clock ran out: it lands, unless it's held or someone looked meanwhile (then it waits again). */
async function landDue(env: Env, self: (req: Request) => Promise<Response>, origin: string, id: number) {
  const p = resultOf(await getRow(env, id)).pending;
  if (!p || p.until === null) return;
  if (p.until > Date.now() + 250) return landLater(env, id, origin, p.until - Date.now());
  await land(env, self, origin, id, "auto");
}

/**
 * Merges run `id`'s branch into main. Where someone changed a line on main since the
 * agent's branch began, theirs stays (and `kept` says what the agent wanted). A merge
 * the checks or a build file hold back waits, held, for a person to accept it.
 */
async function land(env: Env, self: (req: Request) => Promise<Response>, origin: string, id: number, by: string): Promise<Response> {
  const row = await getRow(env, id), run = resultOf(row), p = run.pending;
  if (!row || !p) return json({ error: run.landed ? "it already landed" : "nothing of this run's is waiting" }, 409);
  // Take it, so a landing and an accept at once merge it once.
  const { pending: _, ...rest } = run;
  if (!(await swap(env, id, run, rest))) return json({ error: "it's landing already" }, 409);
  const call = caller(self, origin), url = `/api/repos/${row.owner}/${row.repo}/branches/${encodeURIComponent(p.branch)}/merge`;
  const resolve: Record<string, Record<string, string>> = {}, kept: NonNullable<Run["kept"]> = [];
  // An accept is someone reading it, build files and all; the clock running out isn't.
  const merge = () => call(row.owner, url, { method: "POST", body: JSON.stringify({ resolve, build_ok: by !== "auto" }) });
  let res = await merge();
  for (let i = 0; i < 3 && res.status === 409; i++) {
    const body = await res.clone().json() as { conflicts?: { path: string; conflicts: { line: string; main: string | null; branch: string | null }[] }[] };
    const fresh = (body.conflicts ?? []).flatMap((f) => f.conflicts.map((c) => ({ path: f.path, c }))).filter(({ path, c }) => !resolve[path]?.[c.line]);
    if (!fresh.length) break;
    for (const { path, c } of fresh) { (resolve[path] ??= {})[c.line] = "main"; kept.push({ line: c.line, yours: c.main, wanted: c.branch }); }
    res = await merge();
  }
  if (res.ok) {
    await env.DB.prepare("UPDATE agent_runs SET result = ? WHERE id = ?").bind(JSON.stringify({ ...rest, landed: { at: Date.now(), by }, ...(kept.length ? { kept } : {}) }), id).run();
    return json({ landed: true, kept });
  }
  // Not now: it waits, held, saying why.
  const why = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `merge: ${res.status}`;
  await env.DB.prepare("UPDATE agent_runs SET result = ? WHERE id = ?").bind(JSON.stringify({ ...rest, pending: { branch: p.branch, until: null, why } }), id).run();
  return json({ error: why, held: true }, 409);
}

/** Accept, hold, look at or reject run `id`'s waiting batch. */
async function reviewRun(env: Env, self: (req: Request) => Promise<Response>, origin: string, owner: string, repo: string, id: number, what: string, user: string) {
  const row = await getRow(env, id);
  if (!row || row.owner !== owner || row.repo !== repo) return json({ error: "no such run" }, 404);
  const run = resultOf(row), p = run.pending;
  if (!p) return json({ error: run.landed ? "it already landed" : run.rejected ? "it was rejected" : "nothing of this run's is waiting" }, 409);
  if (what === "accept") {
    if (user === row.agent && user !== owner && await protectOn(env, owner, repo)) return json({ error: "main is protected: someone other than the agent accepts its batch" }, 403);
    return land(env, self, origin, id, user);
  }
  if (what === "reject") {
    const { pending: _, ...rest } = run;
    if (!(await swap(env, id, run, { ...rest, rejected: { at: Date.now(), by: user } }))) return json({ error: "it's landing already" }, 409);
    await dropBranch(env, owner, repo, p.branch, row.path);
    return json(toRun((await getRow(env, id))!, env));
  }
  // Hold stops the clock; a look puts it off a little (a held one stays held).
  const until = what === "hold" || p.until === null ? null : Math.max(p.until, Date.now() + LOOK_MS);
  if (until !== p.until && !(await swap(env, id, run, { ...run, pending: { ...p, until } }))) return json({ error: "it's landing already" }, 409);
  return json(toRun((await getRow(env, id))!, env));
}

/** A run's branch whose batch won't land goes: its copy of the file, then its rows. A merged one stays, as merged branches do. */
async function dropBranch(env: Env, owner: string, repo: string, name: string, path: string) {
  const open = await env.DB.prepare("SELECT 1 FROM branches WHERE owner = ? AND repo = ? AND name = ? AND status = 'open'").bind(owner, repo, name).first();
  if (!open) return;
  await toFile(env, owner, repo, path, "upstream", "wipe", { method: "POST" }, "", name).catch(() => {});
  await env.DB.batch(["branch_files WHERE owner = ? AND repo = ? AND branch = ?", "branches WHERE owner = ? AND repo = ? AND name = ?"]
    .map((t) => env.DB.prepare(`DELETE FROM ${t}`).bind(owner, repo, name)));
}

/**
 * Run `row` stopped short of its budget: who carries on from its note. A fresh agent (on the cheapest
 * model, downshifted) when the policy says so, the task hasn't been handed off HANDOFFS times and the
 * hosted budget has one; else a person.
 */
async function handOff(env: Env, self: (req: Request) => Promise<Response>, origin: string, row: Row, policy: Policy,
  t: { at: number; why: string; note: string; hops: number; branch?: string; lines?: string[]; also?: string[]; rebuild?: string }): Promise<NonNullable<Run["handoff"]>> {
  const base = { at: t.at, why: t.why, note: t.note };
  const over: Over = t.hops >= HANDOFFS ? "escalate" : policy.over;
  if (over === "escalate") return { ...base, over };
  const pick = over === "downshift" ? cheapest(installedHarnesses(env)) : { harness: row.harness, model: row.model ?? undefined };
  if (!pick || await hostedBudget(env)) return { ...base, over: "escalate" };
  const agent = `agent-${pick.harness}`;
  if (pick.harness !== row.harness) await caller(self, origin)(row.owner, `/api/repos/${row.owner}/${row.repo}/collaborators`, { method: "POST", body: JSON.stringify({ name: agent }) });
  const result = { ...(t.lines && { lines: t.lines }), ...(t.also && { also: t.also }), ...(t.rebuild && { rebuild: t.rebuild }), from: row.id, hops: t.hops + 1 };
  const next = await env.DB.prepare("INSERT INTO agent_runs (owner, repo, path, harness, task, model, agent, status, started, branch, result) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?) RETURNING id")
    .bind(row.owner, row.repo, row.path, pick.harness, handoffTask(row.path, t.why, t.note).slice(0, 4000), pick.model ?? null, agent, Date.now(), t.branch ?? null, JSON.stringify(result)).first();
  if (!next) return { ...base, over: "escalate" };
  await launch(env, self, origin, next.id as number);
  return { ...base, over, next: next.id as number };
}

/** The fresh agents run `id` handed off to have finished its batch: its clock goes again, as if it had just ended. */
async function resume(env: Env, origin: string, id: number, wait: number) {
  const run = resultOf(await getRow(env, id));
  if (!run.pending || run.pending.until !== null || run.handoff?.next === undefined) return;
  const pending = { branch: run.pending.branch, until: Date.now() + wait };
  if (await swap(env, id, run, { ...run, pending })) await landLater(env, id, origin, wait);
}

/**
 * What rebuild tasks said a merge rule could have settled (#1226): one row per run that said anything, newest
 * first, out of the runs the repo keeps. The `yes` ones are what a new rule in lines.ts would take off agents.
 */
async function engineSaid(env: Env, owner: string, repo: string) {
  const { results } = await env.DB.prepare("SELECT id, branch, started, result FROM agent_runs WHERE owner = ? AND repo = ? AND json_extract(result, '$.engine') IS NOT NULL ORDER BY id DESC")
    .bind(owner, repo).all();
  return (results as { id: number; branch: string; started: number; result: string }[]).map((r) => {
    const x = parseJson<Partial<Run>>(r.result, {});
    return { run: r.id, branch: r.branch, after: x.rebuild, started: r.started, engine: x.engine! };
  });
}

/** A rebuild task on `branch` is done: the branch goes upstream (branches.ts rebuiltUpstream), and how that went, for its result. */
async function pushRebuilt(env: Env, owner: string, repo: string, branch: string): Promise<Run["pushed"]> {
  const up = await (await import("./branches.ts")).rebuiltUpstream(env, owner, repo, branch).catch((e) => ({ pushed: false, error: `not pushed upstream: ${String((e as Error)?.message ?? e)}` }));
  return up ? { ok: up.pushed, ...(up.error && { error: up.error }) } : undefined;
}

/** Whether a hosted run has said it's alive lately (a run that never has is judged by when it started). */
const alive = (r: Row) => Date.now() - (parseJson<Partial<Run>>(r.result, {}).beat ?? r.started) < DEAD_MS;

/**
 * An update cut run `row` off (its consumer is gone, or its file's object restarted or runs another build):
 * its claim is let go at once rather than idling out its lease, and the run goes round again from the file as it
 * stands, up to MAX_RESTARTS times; then it's left failed. The log says "interrupted by update, retrying".
 * True when it goes round again.
 */
async function interrupt(env: Env, self: (req: Request) => Promise<Response>, origin: string, row: Row, why = ""): Promise<boolean> {
  const x = parseJson<Partial<Run>>(row.result, {}), { beat: _, ...rest } = x, restarts = x.restarts ?? 0;
  if (x.lines?.length) await caller(self, origin)(row.owner, `/api/repos/${row.owner}/${row.repo}/do/claims?path=${encodeURIComponent(row.path)}`,
    { method: "POST", body: JSON.stringify({ id: `run-${row.id}`, release: true }) }).catch(() => {});
  const again = restarts < MAX_RESTARTS && !!env.AGENT_SANDBOX;
  const log = JSON.stringify([...JSON.parse(row.log), again ? "interrupted by update, retrying" : `interrupted by update${why ? `: ${why}` : ""}`].slice(-LOG_LINES));
  if (!again) {
    await env.DB.prepare("UPDATE agent_runs SET log = ? WHERE id = ?").bind(log, row.id).run();
    await finish(env, row.id, "failed", { ...rest, error: `interrupted by update${restarts ? ` ${restarts + 1} times` : ""}: start it again` });
    return false;
  }
  const done = await env.DB.prepare("UPDATE agent_runs SET picked = 0, log = ?, result = ? WHERE id = ? AND status = 'running'").bind(log, JSON.stringify({ ...rest, restarts: restarts + 1 }), row.id).run();
  if (!done.meta?.changes) return false;
  await env.JOBS.send({ agent: row.id, origin }, { delaySeconds: RESTART_S });
  return true;
}

/** Runs the agent of run `id`, keeping its log and result in D1. Only once: a second try (the queue's retry after a cut-off consumer) fails it instead. */
async function execute(env: Env, self: (req: Request) => Promise<Response>, origin: string, id: number): Promise<"held" | void> {
  // Hosted, a feature run (no branch of its own) takes a container only while one is left for fix tasks (#1242): else it stays queued.
  const claimed = await env.DB.prepare(`UPDATE agent_runs SET picked = 1 WHERE id = ? AND picked = 0${env.AGENT_SANDBOX ? " AND (branch IS NOT NULL OR (SELECT COUNT(*) FROM agent_runs WHERE branch IS NULL AND picked = 1 AND status = 'running') < ?)" : ""}`)
    .bind(...env.AGENT_SANDBOX ? [id, HOSTED_FEATURE_SLOTS] : [id]).run();
  if (!claimed.meta?.changes) {
    if (env.AGENT_SANDBOX && (await env.DB.prepare("SELECT 1 AS held FROM agent_runs WHERE id = ? AND picked = 0 AND status = 'running'").bind(id).first())) return "held";
    // Picked up before and still "running": the consumer that had it was cut off (an update), unless it is still saying it's alive.
    const was = await getRow(env, id);
    if (was?.status === "running" && !alive(was)) await interrupt(env, self, origin, was);
    return;
  }
  const row = await getRow(env, id);
  // Stopped before it was picked up off the queue.
  if (!row || row.status !== "running") return;
  const { owner, repo, path, harness, agent } = row;
  // Its batch waits on a branch of its own, made as its owner, unless there's no wait. A fix task
  // (heal.ts) works on the branch it's fixing instead, which is left as it is whatever happens.
  // Protected main (#1426): a batch always has a branch of its own and waits for a person, not a timer.
  const protectedMain = await protectOn(env, owner, repo).catch(() => false);
  const wait = reviewMs(env), own = !row.branch && (wait || protectedMain) ? runBranch(id) : undefined, branch = row.branch ?? own;
  // Stop: on the desktop the route aborts it here; a hosted Stop lands on another
  // isolate, so this one checks D1 every couple of seconds, and right as the agent ends.
  const stopper = liveOf(env).get(id) ?? new AbortController(), signal = stopper.signal;
  // A desktop run off the queue (a fix task) is this process's too, so listing runs doesn't call it cut off.
  if (!env.AGENT_SANDBOX && !liveOf(env).has(id)) liveOf(env).set(id, stopper);
  let given = 0;
  const peek = async () => {
    const r = await env.DB.prepare("SELECT status, notes FROM agent_runs WHERE id = ?").bind(id).first() as Pick<Row, "status" | "notes"> | null;
    if (r?.status !== "running") stopper.abort();
    return r ? JSON.parse(r.notes) as Note[] : [];
  };
  const checking = setInterval(() => void peek().catch(() => {}), CHECK_MS);
  // A hosted run says it's alive, so a listing or a retry can tell a run an update cut off from one that's still going.
  const beating = env.AGENT_SANDBOX ? setInterval(() => void env.DB.prepare("UPDATE agent_runs SET result = json_set(COALESCE(result, '{}'), '$.beat', ?) WHERE id = ? AND status = 'running'").bind(Date.now(), id).run().catch(() => {}), BEAT_MS) : undefined;
  // A hosted run ends at its deadline, however many times its CLI has been round.
  const cutoff = env.AGENT_SANDBOX ? setTimeout(() => void env.DB.prepare("UPDATE agent_runs SET status = 'stopped', result = json_set(COALESCE(result, '{}'), '$.error', ?) WHERE id = ? AND status = 'running'")
    .bind(`out of time: a hosted run gets ${every(HOSTED_RUN_MS / 1000)}`, id).run().catch(() => {}).finally(() => stopper.abort()), Math.max(0, row.started + HOSTED_RUN_MS - Date.now())) : undefined;
  const call = caller(self, origin);
  const { lines, also, from, hops, rebuild, restarts } = parseJson<Partial<Run>>(row.result, {});
  const extra: Partial<Run> = { ...(restarts && { restarts }), ...(lines && { lines }), ...(also && { also }), ...(from && { from, hops }), ...(rebuild && { rebuild }) };
  try {
    const box = env.AGENT_SANDBOX ? containerSandbox(env.AGENT_SANDBOX) : localSandbox(env.AGENT_EXEC as Exec | undefined);
    // A Stop between checks still keeps what the agent left from landing.
    let sandbox: Sandbox = async (cmd, file, sig) => { const r = await box(cmd, file, sig); await peek(); return r; };
    // A hosted agent works on GitHub as the account its owner picked for agents (a bot,
    // say), not as the one they dig as; with none picked it gets no GitHub token at all.
    // Nor does one that can't run a command, or a fix task the doctor started (#1428).
    const gh = env.AGENT_SANDBOX && !row.branch && RUNS_COMMANDS.includes(harness) ? await agentGithubToken(env, owner).catch(() => null) : null;
    if (gh) {
      const inner = sandbox;
      sandbox = (cmd, file, sig) => inner({ ...cmd, env: { ...cmd.env, GH_TOKEN: gh, GITHUB_TOKEN: gh } }, file, sig);
      extra.github = true;
      await env.DB.prepare("UPDATE agent_runs SET result = ? WHERE id = ?").bind(JSON.stringify(extra), id).run();
    }
    const log: string[] = JSON.parse(row.log);
    let logged = Promise.resolve();
    // Started over after an update: its branch is there already, with what it landed before.
    if (own && !(restarts && await env.DB.prepare("SELECT 1 FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, own).first())) {
      const made = await call(owner, `/api/repos/${owner}/${repo}/branches`, { method: "POST", body: JSON.stringify({ name: own }) });
      if (!made.ok) throw new Error(`making its branch ${own}: ${await made.text()}`);
    }
    // A fix task wasn't started from the route, which adds the agent to the crew.
    if (row.branch) {
      const added = await call(owner, `/api/repos/${owner}/${repo}/collaborators`, { method: "POST", body: JSON.stringify({ name: agent }) });
      if (!added.ok) throw new Error(`adding ${agent}: ${await added.text()}`);
    }
    const policy = await policyFor(env, owner, repo, path);
    // A fix task's path comes from a branch, not the start route, so the lock is checked here too.
    if (policy.live === "locked") throw new Error(locked(path));
    const r = await runAgent(call, {
      user: agent, owner, repo, path, harness, task: row.task, model: row.model ?? undefined, sandbox, lines, claim: `run-${id}`, signal, branch, also,
      secrets: [...LOGINS.map((k) => env[k]), gh],
      budget: { tokens: policy.budget, over: policy.over },
      progress: (progress) => void env.DB.prepare("UPDATE agent_runs SET result = json_set(COALESCE(result, '{}'), '$.progress', json(?)) WHERE id = ? AND status = 'running'").bind(JSON.stringify(progress), id).run().catch(() => {}),
      notes: async () => { const all = await peek(); const fresh = all.slice(given).map((n) => n.text); given = all.length; return fresh; },
      log: (s) => {
        log.push(s);
        const tail = JSON.stringify(log.slice(-LOG_LINES));
        logged = logged.then(async () => { await env.DB.prepare("UPDATE agent_runs SET log = ? WHERE id = ?").bind(tail, id).run(); }).catch(() => {});
      },
    });
    await logged;
    // Cut short: a note, and who carries on from it. A fresh agent works on the branch with this one's edits.
    // Notes its owner sent that it never read, the ones since its last look too, go in the note's NEXT (#1090).
    const unheard = r.tripped ? [...r.unheard ?? [], ...(await peek().catch(() => [])).slice(given).map((n) => n.text)] : [];
    const handoff = r.tripped && await handOff(env, self, origin, row, policy, {
      ...r.tripped, hops: hops ?? 0, branch: r.applied ? branch : row.branch ?? undefined, lines, also, rebuild,
      note: noteFor({ path, task: row.task, why: r.tripped.why, applied: r.applied, edited: r.edited, conflicts: r.conflicts, failures: r.failures, output: r.output, notes: unheard }),
    });
    // Its batch waits for whoever took over: held till the fresh agent is done, or for a person.
    const pending = !own || !r.applied ? undefined : !handoff ? { branch: own, until: protectedMain ? null : Date.now() + wait, ...(protectedMain && { why: "main is protected: a person accepts it" }) }
      : { branch: own, until: null, why: handoff.next ? `handed off to run ${handoff.next}` : `stopped at ~${short(handoff.at)} tokens (${handoff.why}): a person's turn` };
    const engine = rebuild ? engineLines(r.output) : [];
    // A rebuild that ended with both sides on its branch takes it upstream, so its pull request stops clashing (#1226).
    // It goes while the run still says running, so a sync takes main in for it meanwhile (takeMainUpstream) leaves it be.
    // One handed off waits for whoever took over.
    // One that edited a file that runs at build time (.github/workflows/*, a lockfile) waits for a person: a push runs it with the repo's secrets.
    const build = [path, ...(r.edited ?? [])].filter(isBuildFile);
    const pushed = rebuild && row.branch && !handoff && !signal.aborted
      ? build.length ? { ok: false, error: `left for a person: the task edited ${[...new Set(build)].join(", ")}, which run at build time. Review the branch, then push it` } : await pushRebuilt(env, owner, repo, row.branch)
      : undefined;
    const done = await finish(env, id, "done", { ...extra, ...(engine.length && { engine }), ...(pushed && { pushed }), applied: r.applied, rev: r.rev, runs: r.runs, conflicts: r.conflicts, output: r.output.slice(-4000), spent: r.spent, ...(r.edited && { edited: r.edited }), ...(pending ? { pending } : {}), ...(handoff && { handoff }) });
    // Stopped just as it ended: nothing waits.
    if (pending?.until && done.meta?.changes) await landLater(env, id, origin, wait);
    else if (own && !pending) await dropBranch(env, owner, repo, own, path);
    // A fresh agent that finished the batch it took over sets that batch's clock going again.
    const held = /^agent-run-(\d+)$/.exec(row.branch ?? "")?.[1];
    if (held && from && !handoff && done.meta?.changes) await resume(env, origin, Number(held), wait);
  } catch (e) {
    if (signal.aborted) {
      const stopped = await getRow(env, id);
      const was = parseJson<Partial<Run>>(stopped?.result, {});
      await env.DB.prepare("UPDATE agent_runs SET result = ? WHERE id = ? AND status = 'stopped'").bind(JSON.stringify({ ...extra, error: was.error ?? "stopped" }), id).run();
    } else if (e instanceof Interrupted) {
      // An update cut it off: its branch (and what it landed there) stays for the run that goes round again.
      const again = await interrupt(env, self, origin, await getRow(env, id) ?? row, e.message);
      if (again) return;
    } else await finish(env, id, "failed", { ...extra, error: String((e as Error)?.message ?? e).slice(-4000) });
    // Whatever it left on its branch goes with it.
    if (own) await dropBranch(env, owner, repo, own, path);
  } finally { clearInterval(checking); clearInterval(beating); clearTimeout(cutoff); if (row.branch) liveOf(env).delete(id); }
}
