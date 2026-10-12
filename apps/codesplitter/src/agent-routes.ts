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
//   POST /api/repos/:o/:r/agents {path, harness, task, model?, lines?}  start one; answers at once (202).
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
//
// A run's batch doesn't land on main as it's written (#745). The agent works on a branch of its own,
// agent-run-<id>, and when it ends the batch waits there for AGENT_REVIEW_MS (8 seconds by default),
// shown on main's file page as a ghost diff with a countdown. Then it merges into main on its own (a
// JOBS message, delayed), unless someone said otherwise: look puts the landing off while they read it,
// hold stops the clock till they accept, accept lands it now, reject throws it away. A line someone
// changed on main meanwhile keeps their version, and the run's `kept` says what the agent wanted there.
// A batch that touches build or deploy files, or that the repo's required checks hold, waits for an accept.
// AGENT_REVIEW_MS=0 writes main directly, as the agent goes.

import { json, type Env } from "./env.ts";
import { charge, every, SITE } from "./limits.ts";
import { accountsOn, actingAs, isAdmin } from "./identity.ts";
import { HARNESSES, harnessCommand, type Harness } from "./harness.ts";
import { localSandbox, runAgent, type Conflict, type Exec, type Sandbox } from "./agent-run.ts";
import { containerSandbox } from "./sandbox.ts";
import { agentGithubToken } from "./github.ts";
import { toFile } from "./archive.ts";

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
}

export interface Note { text: string; at: number }

/** A queue consumer's wall time, so a hosted run's limit. */
const HOSTED_RUN_MS = 15 * 60_000;
/** How many runs each repo keeps. */
const KEEP = 50;
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

interface Row { id: number; owner: string; repo: string; path: string; harness: Harness; task: string; model: string | null; agent: string; status: Run["status"]; started: number; picked: number; log: string; result: string | null; notes: string }

const toRun = (r: Row, env: Env): Run => ({ ...(env.AGENT_SANDBOX ? { deadline: r.started + HOSTED_RUN_MS } : {}), id: r.id, owner: r.owner, repo: r.repo, path: r.path, harness: r.harness, task: r.task, agent: r.agent, status: r.status, started: r.started, log: JSON.parse(r.log), notes: JSON.parse(r.notes ?? "[]"), ...(r.result ? JSON.parse(r.result) : {}) });
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
const live = new Map<number, AbortController>();

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

/** The harnesses whose CLI is on PATH (all of them when a test swaps the CLI out). */
export const installedHarnesses = (env: Env) => env.AGENT_EXEC || env.AGENT_SANDBOX ? HARNESSES : HARNESSES.filter((h) => Bun.which(harnessCommand(h, "").bin));

export async function agentRoutes(req: Request, env: Env, p: string[], url: URL, user: string | null,
  access: (owner: string, repo: string) => Promise<{ read: boolean; write: boolean }>,
  self: (req: Request) => Promise<Response>): Promise<Response | null> {
  if (p[1] === "agents" && !p[2]) {
    const why = agentsUnavailable(env);
    return json({ available: !why, why, harnesses: why ? [] : installedHarnesses(env), all: HARNESSES, admins_only: adminsOnly(env, user) });
  }
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "agents")) return null;
  const [owner, repo] = [p[2], p[3]];
  const stop = p[5] === "stop" && !p[6], one = !!p[5] && /^\d+$/.test(p[5]) && !p[7];
  const note = one && p[6] === "notes", review = one && REVIEWS.includes(p[6] ?? ""), waiting = p[5] === "waiting" && !p[6];
  if (p[5] && !stop && !note && !review && !waiting) return null;
  const a = await access(owner, repo);
  if (!a.read) return json({ error: "not found" }, 404);
  if (waiting) return req.method === "GET" ? waitingOn(env, self, url, owner, repo, user, a.write) : null;
  if (stop || note || review) {
    if (req.method !== "POST") return null;
    // The crew can put a batch off (look) or stop its clock (hold); landing or binning it is the owner's.
    const crewMay = review && (p[6] === "look" || p[6] === "hold");
    if (crewMay ? !a.write : user !== owner) return json({ error: crewMay ? "only the repo's crew can hold or look at an agent's batch" : "only the repo's owner can stop, tell, accept or reject its coding agents" }, 403);
    if (review) return reviewRun(env, self, url.origin, owner, repo, Number(p[5]), p[6]!, user!);
    return stop ? stopRuns(req, env, owner, repo, user!, caller(self, url.origin)) : tell(req, env, owner, repo, Number(p[5]));
  }

  if (req.method === "GET") {
    // A run's task and output can quote the repo's code and the agent's chatter,
    // so only the owner, who started them, sees them.
    if (user !== owner) return json({ error: "only the repo's owner can see its coding agents" }, 403);
    const path = url.searchParams.get("path");
    const { results } = await env.DB.prepare(`SELECT * FROM agent_runs WHERE owner = ? AND repo = ?${path ? " AND path = ?" : ""} ORDER BY id DESC LIMIT ${KEEP}`)
      .bind(...[owner, repo, path].filter((x) => x !== null)).all();
    const rows = results as Row[];
    if (!env.AGENT_SANDBOX) for (const r of rows) if (r.status === "running" && !live.has(r.id)) {
      const error = "the app stopped before the agent finished";
      await finish(env, r.id, "failed", { error });
      Object.assign(r, { status: "failed", result: JSON.stringify({ error }) });
    }
    await relaunch(env, rows, url.origin);
    return json(rows.map((r) => toRun(r, env)));
  }
  if (req.method !== "POST") return null;
  const why = agentsUnavailable(env);
  if (why) return json({ error: why }, 501);
  if (user !== owner) return json({ error: "only the repo's owner can start a coding agent" }, 403);
  if (adminsOnly(env, user)) return json({ error: ADMINS_ONLY }, 403);
  const { path, harness, task, model, lines } = (await req.json()) as { path?: string; harness?: Harness; task?: string; model?: string; lines?: string[] };
  if (lines !== undefined && !(Array.isArray(lines) && lines.every((l) => typeof l === "string"))) return json({ error: "lines: line ids" }, 400);
  if (!path) return json({ error: "path required" }, 400);
  if (!harness || !HARNESSES.includes(harness)) return json({ error: `harness: ${HARNESSES.join(", ")}` }, 400);
  if (!installedHarnesses(env).includes(harness)) return json({ error: `${harness} isn't installed on this machine` }, 400);
  if (!task?.trim()) return json({ error: "task required" }, 400);
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
  if (env.AGENT_SANDBOX) await env.JOBS.send({ agent: row.id, origin });
  else { live.set(row.id, new AbortController()); void execute(env, self, origin, row.id).finally(() => live.delete(row.id)); }
  return json(toRun(row, env), 202);
}

/** Stops the repo's running runs that match every filter given (none: all of them). */
async function stopRuns(req: Request, env: Env, owner: string, repo: string, user: string, call: ReturnType<typeof caller>) {
  const { ids, path, harness, lines } = (await req.json().catch(() => ({}))) as { ids?: number[]; path?: string; harness?: string; lines?: string[] };
  if (ids !== undefined && !(Array.isArray(ids) && ids.every(Number.isInteger))) return json({ error: "ids: run ids" }, 400);
  if (lines !== undefined && !(Array.isArray(lines) && lines.every((l) => typeof l === "string"))) return json({ error: "lines: line ids" }, 400);
  const { results } = await env.DB.prepare("SELECT * FROM agent_runs WHERE owner = ? AND repo = ? AND status = 'running'").bind(owner, repo).all();
  const want = lines && new Set(lines);
  const hit = (results as Row[]).filter((r) => {
    const claimed = (r.result ? JSON.parse(r.result) as Partial<Run> : {}).lines;
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
    live.get(r.id)?.abort();
    // Its lines are free now, even if the run itself is gone (cut off, or the app quit).
    if (result.lines) await call(owner, `/api/repos/${owner}/${repo}/do/claims?path=${encodeURIComponent(r.path)}`, { method: "POST", body: JSON.stringify({ id: `run-${r.id}`, release: true }) }).catch(() => {});
  }
  return json({ stopped });
}

/** Leaves a note for running run `id`, which its next run's prompt carries. */
async function tell(req: Request, env: Env, owner: string, repo: string, id: number) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
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
    else await execute(env, self, m.body.origin, m.body.agent);
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
  const { results } = await env.DB.prepare(`SELECT * FROM agent_runs WHERE owner = ? AND repo = ? AND path = ? ORDER BY id DESC LIMIT ${KEEP}`).bind(owner, repo, path).all();
  const rows = results as Row[], day = Date.now() - 86_400_000;
  await relaunch(env, rows, url.origin);
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
  if (what === "accept") return land(env, self, origin, id, user);
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

/** Runs the agent of run `id`, keeping its log and result in D1. Only once: a second try (the queue's retry after a cut-off consumer) fails it instead. */
async function execute(env: Env, self: (req: Request) => Promise<Response>, origin: string, id: number) {
  const claimed = await env.DB.prepare("UPDATE agent_runs SET picked = 1 WHERE id = ? AND picked = 0").bind(id).run();
  if (!claimed.meta?.changes) {
    await env.DB.prepare("UPDATE agent_runs SET status = 'failed', result = ? WHERE id = ? AND status = 'running'")
      .bind(JSON.stringify({ error: "the agent was cut off before it finished" }), id).run();
    return;
  }
  const row = await getRow(env, id);
  // Stopped before it was picked up off the queue.
  if (!row || row.status !== "running") return;
  const { owner, repo, path, harness, agent } = row;
  // Its batch waits on a branch of its own, made as its owner, unless there's no wait.
  const wait = reviewMs(env), branch = wait ? runBranch(id) : undefined;
  // Stop: on the desktop the route aborts it here; a hosted Stop lands on another
  // isolate, so this one checks D1 every couple of seconds, and right as the agent ends.
  const stopper = live.get(id) ?? new AbortController(), signal = stopper.signal;
  let given = 0;
  const peek = async () => {
    const r = await env.DB.prepare("SELECT status, notes FROM agent_runs WHERE id = ?").bind(id).first() as Pick<Row, "status" | "notes"> | null;
    if (r?.status !== "running") stopper.abort();
    return r ? JSON.parse(r.notes) as Note[] : [];
  };
  const checking = setInterval(() => void peek().catch(() => {}), CHECK_MS);
  // A hosted run ends at its deadline, however many times its CLI has been round.
  const cutoff = env.AGENT_SANDBOX ? setTimeout(() => void env.DB.prepare("UPDATE agent_runs SET status = 'stopped', result = json_set(COALESCE(result, '{}'), '$.error', ?) WHERE id = ? AND status = 'running'")
    .bind(`out of time: a hosted run gets ${every(HOSTED_RUN_MS / 1000)}`, id).run().catch(() => {}).finally(() => stopper.abort()), Math.max(0, row.started + HOSTED_RUN_MS - Date.now())) : undefined;
  const call = caller(self, origin);
  const { lines } = row.result ? JSON.parse(row.result) as Partial<Run> : {};
  const extra: Partial<Run> = lines ? { lines } : {};
  try {
    const box = env.AGENT_SANDBOX ? containerSandbox(env.AGENT_SANDBOX) : localSandbox(env.AGENT_EXEC as Exec | undefined);
    // A Stop between checks still keeps what the agent left from landing.
    let sandbox: Sandbox = async (cmd, file, sig) => { const r = await box(cmd, file, sig); await peek(); return r; };
    // A hosted agent works on GitHub as the account its owner picked for agents (a bot,
    // say), not as the one they dig as; with none picked it gets no GitHub token at all.
    const gh = env.AGENT_SANDBOX ? await agentGithubToken(env, owner).catch(() => null) : null;
    if (gh) {
      const inner = sandbox;
      sandbox = (cmd, file) => inner({ ...cmd, env: { ...cmd.env, GH_TOKEN: gh, GITHUB_TOKEN: gh } }, file);
      extra.github = true;
      await env.DB.prepare("UPDATE agent_runs SET result = ? WHERE id = ?").bind(JSON.stringify(extra), id).run();
    }
    const log: string[] = JSON.parse(row.log);
    let logged = Promise.resolve();
    if (branch) {
      const made = await call(owner, `/api/repos/${owner}/${repo}/branches`, { method: "POST", body: JSON.stringify({ name: branch }) });
      if (!made.ok) throw new Error(`making its branch ${branch}: ${await made.text()}`);
    }
    const r = await runAgent(call, {
      user: agent, owner, repo, path, harness, task: row.task, model: row.model ?? undefined, sandbox, lines, claim: `run-${id}`, signal, branch,
      notes: async () => { const all = await peek(); const fresh = all.slice(given).map((n) => n.text); given = all.length; return fresh; },
      log: (s) => {
        log.push(s);
        const tail = JSON.stringify(log.slice(-LOG_LINES));
        logged = logged.then(() => env.DB.prepare("UPDATE agent_runs SET log = ? WHERE id = ?").bind(tail, id).run()).catch(() => {});
      },
    });
    await logged;
    const pending = branch && r.applied ? { branch, until: Date.now() + wait } : undefined;
    const done = await finish(env, id, "done", { ...extra, applied: r.applied, rev: r.rev, runs: r.runs, conflicts: r.conflicts, output: r.output.slice(-4000), ...(pending ? { pending } : {}) });
    // Stopped just as it ended: nothing waits.
    if (pending && done.meta?.changes) await landLater(env, id, origin, wait);
    else if (branch) await dropBranch(env, owner, repo, branch, path);
  } catch (e) {
    if (signal.aborted) {
      const stopped = await getRow(env, id);
      const was = stopped?.result ? JSON.parse(stopped.result) as Partial<Run> : {};
      await env.DB.prepare("UPDATE agent_runs SET result = ? WHERE id = ? AND status = 'stopped'").bind(JSON.stringify({ ...extra, error: was.error ?? "stopped" }), id).run();
    } else await finish(env, id, "failed", { ...extra, error: String((e as Error)?.message ?? e).slice(-4000) });
    // Whatever it left on its branch goes with it.
    if (branch) await dropBranch(env, owner, repo, branch, path);
  } finally { clearInterval(checking); clearTimeout(cutoff); }
}
