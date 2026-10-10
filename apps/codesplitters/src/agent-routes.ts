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
// A container run answers when it is done (200), since an isolate's memory is
// not where the next poll lands; a local one answers at once (202).
//
//   GET  /api/agents                                     which harnesses this machine can run
//   POST /api/repos/:o/:r/agents {path, harness, task, model?}  start one; answers at once
//   GET  /api/repos/:o/:r/agents?path=                   this file's runs, newest first (owner only)

import { json, type Env } from "./env.ts";
import { accountsOn, actingAs, isAdmin } from "./identity.ts";
import { HARNESSES, harnessCommand, type Harness } from "./harness.ts";
import { localSandbox, runAgent, type Conflict, type Exec } from "./agent-run.ts";
import { containerSandbox } from "./sandbox.ts";

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
  output?: string;
  error?: string;
}

// Runs live in this process: the desktop app is one process, and a run is
// only interesting while you watch it. The last 50 are kept.
const runs: Run[] = [];
let nextId = 1;

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
    return json(runs.filter((r) => r.owner === owner && r.repo === repo && (!path || r.path === path)).reverse());
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
  const agent = `agent-${harness}`, origin = url.origin;
  const call = (who: string | null, path: string, init: RequestInit = {}) => {
    const r = new Request(origin + path, init);
    if (who) actingAs.set(r, who);
    return self(r);
  };
  const added = await call(owner, `/api/repos/${owner}/${repo}/collaborators`, { method: "POST", body: JSON.stringify({ name: agent }) });
  if (!added.ok) return json({ error: `adding ${agent}: ${await added.text()}` }, 500);

  const run: Run = { id: nextId++, owner, repo, path, harness, task: task.trim().slice(0, 2000), agent, status: "running", started: Date.now(), log: [] };
  runs.push(run);
  if (runs.length > 50) runs.splice(0, runs.length - 50);
  const sandbox = env.AGENT_SANDBOX ? containerSandbox(env.AGENT_SANDBOX) : localSandbox(env.AGENT_EXEC as Exec | undefined);
  const done = runAgent(call, {
    user: agent, owner, repo, path, harness, task: run.task, model: model?.trim() || undefined,
    sandbox, log: (s) => run.log.push(s),
  }).then((r) => {
    Object.assign(run, { status: "done", applied: r.applied, rev: r.rev, runs: r.runs, conflicts: r.conflicts, output: r.output.slice(-4000) });
  }, (e: Error) => {
    Object.assign(run, { status: "failed", error: String(e?.message ?? e).slice(-4000) });
  });
  if (env.AGENT_SANDBOX) { await done; return json(run); }
  return json(run, 202);
}
