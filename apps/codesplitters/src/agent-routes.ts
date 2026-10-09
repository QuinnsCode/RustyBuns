// Coding agents from the file page. The repo owner picks a harness (claude,
// codex, pi, opencode), types a task, and the agent runs on this machine with
// the CLI's own login. Its edit lands as line ops on the file, so every open
// page sees it live and blame says `agent-<harness>`.
//
// Desktop only: the agent is a local CLI, so on Cloudflare (no Bun, no CLIs)
// the routes say so. Owner only: the CLI runs as the machine's user and can run
// shell commands, so only the person whose machine it is may start one.
//
//   GET  /api/agents                                     which harnesses this machine can run
//   POST /api/repos/:o/:r/agents {path, harness, task, model?}  start one; answers at once
//   GET  /api/repos/:o/:r/agents?path=                   this file's runs, newest first

import { json, type Env } from "./env.ts";
import { accountsOn } from "./identity.ts";
import { HARNESSES, harnessCommand, type Harness } from "./harness.ts";
import { runAgent, type Conflict, type Exec } from "./agent-run.ts";

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

/** Why agents can't run here, or null when they can. The agent signs in by alias, so accounts must be off. */
function unavailable(env: Env): string | null {
  if (typeof Bun === "undefined") return "Coding agents run on the desktop app, where their CLIs are installed.";
  if (accountsOn(env)) return "Coding agents need the desktop app (accounts off).";
  return null;
}

/** The harnesses whose CLI is on PATH (all of them when a test swaps the CLI out). */
const installed = (env: Env) => env.AGENT_EXEC ? HARNESSES : HARNESSES.filter((h) => Bun.which(harnessCommand(h, "").bin));

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
    const path = url.searchParams.get("path");
    return json(runs.filter((r) => r.owner === owner && r.repo === repo && (!path || r.path === path)).reverse());
  }
  if (req.method !== "POST") return null;
  if (user !== owner) return json({ error: "only the repo's owner can start a coding agent" }, 403);
  const why = unavailable(env);
  if (why) return json({ error: why }, 501);
  const { path, harness, task, model } = (await req.json()) as { path?: string; harness?: Harness; task?: string; model?: string };
  if (!path) return json({ error: "path required" }, 400);
  if (!harness || !HARNESSES.includes(harness)) return json({ error: `harness: ${HARNESSES.join(", ")}` }, 400);
  if (!installed(env).includes(harness)) return json({ error: `${harness} isn't installed on this machine` }, 400);
  if (!task?.trim()) return json({ error: "task required" }, 400);

  // The agent edits as its own collaborator, so blame shows which agent wrote what.
  const agent = `agent-${harness}`, origin = url.origin;
  const call = (who: string | null, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (who) headers.set("cookie", `cs_user=${who}`);
    return self(new Request(origin + path, { ...init, headers }));
  };
  const added = await call(owner, `/api/repos/${owner}/${repo}/collaborators`, { method: "POST", body: JSON.stringify({ name: agent }) });
  if (!added.ok) return json({ error: `adding ${agent}: ${await added.text()}` }, 500);

  const run: Run = { id: nextId++, owner, repo, path, harness, task: task.trim().slice(0, 2000), agent, status: "running", started: Date.now(), log: [] };
  runs.push(run);
  if (runs.length > 50) runs.splice(0, runs.length - 50);
  runAgent(call, {
    user: agent, owner, repo, path, harness, task: run.task, model: model?.trim() || undefined,
    exec: env.AGENT_EXEC as Exec | undefined, log: (s) => run.log.push(s),
  }).then((r) => {
    Object.assign(run, { status: "done", applied: r.applied, rev: r.rev, runs: r.runs, conflicts: r.conflicts, output: r.output.slice(-4000) });
  }, (e: Error) => {
    Object.assign(run, { status: "failed", error: String(e?.message ?? e).slice(-4000) });
  });
  return json(run, 202);
}
