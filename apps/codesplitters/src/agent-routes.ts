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
//   POST /api/repos/:o/:r/agents {path, harness, task, model?}  start one; answers at once (202)
//   GET  /api/repos/:o/:r/agents?path=                   this file's runs (the repo's without path), newest first (owner only)

import { json, type Env } from "./env.ts";
import { accountsOn, actingAs, isAdmin } from "./identity.ts";
import { HARNESSES, harnessCommand, type Harness } from "./harness.ts";
import { localSandbox, runAgent, type Conflict, type Exec } from "./agent-run.ts";
import { containerSandbox } from "./sandbox.ts";
import { agentGithubToken } from "./github.ts";

export interface Run {
  id: number;
  owner: string; repo: string; path: string;
  harness: Harness; task: string;
  /** The collaborator the edit is blamed on. */
  agent: string;
  status: "running" | "done" | "failed";
  started: number;
  log: string[];
  applied?: number; rev?: number; runs?: number;
  conflicts?: Conflict[];
  /** Whether it ran with the GitHub its owner picked for agents. */
  github?: boolean;
  output?: string;
  error?: string;
}

/** How many runs each repo keeps. */
const KEEP = 50;
/** How many of a run's log lines are kept. */
const LOG_LINES = 50;

interface Row { id: number; owner: string; repo: string; path: string; harness: Harness; task: string; model: string | null; agent: string; status: Run["status"]; started: number; picked: number; log: string; result: string | null }

const toRun = (r: Row): Run => ({ id: r.id, owner: r.owner, repo: r.repo, path: r.path, harness: r.harness, task: r.task, agent: r.agent, status: r.status, started: r.started, log: JSON.parse(r.log), ...(r.result ? JSON.parse(r.result) : {}) });
const getRow = (env: Env, id: number) => env.DB.prepare("SELECT * FROM agent_runs WHERE id = ?").bind(id).first() as Promise<Row | null>;
const finish = (env: Env, id: number, status: "done" | "failed", result: Partial<Run>) =>
  env.DB.prepare("UPDATE agent_runs SET status = ?, result = ? WHERE id = ?").bind(status, JSON.stringify(result), id).run();

/** A JOBS message that starts hosted run `agent`; `origin` is the site's, for the agent's calls to the API. */
export interface AgentMessage { agent: number; origin: string }

/** Calls the app as `who`, as the agent and its owner do. */
const caller = (self: (req: Request) => Promise<Response>, origin: string) => (who: string | null, path: string, init: RequestInit = {}) => {
  const r = new Request(origin + path, init);
  if (who) actingAs.set(r, who);
  return self(r);
};

// The desktop's runs going on in this process: one still `running` in D1 that
// isn't here was cut off when the app quit.
const live = new Set<number>();

/** Why agents can't run here, or null when they can. Hosted ones need accounts on; local ones off, since the agent signs in by alias. */
function unavailable(env: Env): string | null {
  if (env.AGENT_SANDBOX) return accountsOn(env) ? null : "Hosted agents need accounts on (BETTER_AUTH_SECRET): with aliases anyone can claim an admin's handle.";
  if (typeof Bun === "undefined") return "Coding agents run on the desktop app, where their CLIs are installed.";
  if (accountsOn(env)) return "Coding agents need the desktop app (accounts off).";
  return null;
}

/** The harnesses whose CLI is on PATH (all of them when a test swaps the CLI out). */
const installed = (env: Env) => env.AGENT_EXEC || env.AGENT_SANDBOX ? HARNESSES : HARNESSES.filter((h) => Bun.which(harnessCommand(h, "").bin));

export async function agentRoutes(req: Request, env: Env, p: string[], url: URL, user: string | null,
  canRead: (owner: string, repo: string) => Promise<boolean>,
  self: (req: Request) => Promise<Response>): Promise<Response | null> {
  if (p[1] === "agents" && !p[2]) {
    const why = unavailable(env);
    return json({ available: !why, why, harnesses: why ? [] : installed(env), all: HARNESSES });
  }
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "agents" && !p[5])) return null;
  const [owner, repo] = [p[2], p[3]];
  if (!(await canRead(owner, repo))) return json({ error: "not found" }, 404);

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
    return json(rows.map(toRun));
  }
  if (req.method !== "POST") return null;
  const why = unavailable(env);
  if (why) return json({ error: why }, 501);
  if (user !== owner) return json({ error: "only the repo's owner can start a coding agent" }, 403);
  // Hosted runs bill the site's own API keys, and anyone can sign up and own a
  // repo, so only the handles in ADMINS may start one.
  if (env.AGENT_SANDBOX && !(env.ADMINS && isAdmin(env, user))) return json({ error: "hosted agents are limited to this site's admins (ADMINS)" }, 403);
  const { path, harness, task, model } = (await req.json()) as { path?: string; harness?: Harness; task?: string; model?: string };
  if (!path) return json({ error: "path required" }, 400);
  if (!harness || !HARNESSES.includes(harness)) return json({ error: `harness: ${HARNESSES.join(", ")}` }, 400);
  if (!installed(env).includes(harness)) return json({ error: `${harness} isn't installed on this machine` }, 400);
  if (!task?.trim()) return json({ error: "task required" }, 400);

  // The agent edits as its own collaborator, so blame shows which agent wrote what.
  const agent = `agent-${harness}`, origin = url.origin, call = caller(self, origin);
  const added = await call(owner, `/api/repos/${owner}/${repo}/collaborators`, { method: "POST", body: JSON.stringify({ name: agent }) });
  if (!added.ok) return json({ error: `adding ${agent}: ${await added.text()}` }, 500);

  const model_ = model?.trim() || null;
  const row = await env.DB.prepare("INSERT INTO agent_runs (owner, repo, path, harness, task, model, agent, status, started) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?) RETURNING *")
    .bind(owner, repo, path, harness, task.trim().slice(0, 2000), model_, agent, Date.now()).first() as Row;
  await env.DB.prepare(`DELETE FROM agent_runs WHERE owner = ? AND repo = ? AND id NOT IN (SELECT id FROM agent_runs WHERE owner = ? AND repo = ? ORDER BY id DESC LIMIT ${KEEP})`)
    .bind(owner, repo, owner, repo).run();
  if (env.AGENT_SANDBOX) await env.JOBS.send({ agent: row.id, origin });
  else { live.add(row.id); void execute(env, self, origin, row.id).finally(() => live.delete(row.id)); }
  return json(toRun(row), 202);
}

/** The JOBS queue's agent messages (worker.ts): each hosted run, side by side, since one can take minutes. */
export async function runQueuedAgents(messages: readonly { body: AgentMessage; ack(): void }[], env: Env, self: (req: Request) => Promise<Response>) {
  await Promise.all(messages.map(async (m) => { await execute(env, self, m.body.origin, m.body.agent); m.ack(); }));
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
  if (!row) return;
  const { owner, repo, path, harness, agent } = row;
  const call = caller(self, origin);
  const extra: Partial<Run> = {};
  try {
    let sandbox = env.AGENT_SANDBOX ? containerSandbox(env.AGENT_SANDBOX) : localSandbox(env.AGENT_EXEC as Exec | undefined);
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
    const r = await runAgent(call, {
      user: agent, owner, repo, path, harness, task: row.task, model: row.model ?? undefined, sandbox,
      log: (s) => {
        log.push(s);
        const tail = JSON.stringify(log.slice(-LOG_LINES));
        logged = logged.then(() => env.DB.prepare("UPDATE agent_runs SET log = ? WHERE id = ?").bind(tail, id).run()).catch(() => {});
      },
    });
    await logged;
    await finish(env, id, "done", { ...extra, applied: r.applied, rev: r.rev, runs: r.runs, conflicts: r.conflicts, output: r.output.slice(-4000) });
  } catch (e) {
    await finish(env, id, "failed", { ...extra, error: String((e as Error)?.message ?? e).slice(-4000) });
  }
}
