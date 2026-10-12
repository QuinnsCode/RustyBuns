// Layout: self-healing CI: a failed required check, or a merge guard tripping, opens a fix task on the branch
// Self-healing CI (#1015). When a required check fails on an open branch, or a merge of it trips a
// guard (git's conflict markers, a JSON, YAML or TOML file that won't parse, code that won't build:
// the `lint:` conflicts in lines.ts), a coding agent is started on that branch on its own: an agent
// run (agent-routes.ts) whose task carries the failing log or the guard's words, on the file
// involved. It edits the branch's copy itself, so when it's done the branch has changed, its checks
// run again (checks.ts branchEdited), and nothing lands on main. One runs at a time per branch, and
// a branch gets MAX_ATTEMPTS of them. After that it waits for a person: the merge gate says so, and
// GET .../checks?ref=<branch> lists the attempts under `heal`.
//
// It runs where coding agents do, and on as they are: hosted, with the AGENTS flag
// (CODESPLITTER_AGENTS=1 binds AGENT_SANDBOX), for an owner in ADMINS, each run taking one from the
// site's `hosted` budget; on the desktop only with HEAL=1, since the CLI runs on its owner's login.
// HEAL=off turns it off anywhere. A branch an agent run made for its batch (agent-run-<id>) is left
// be: its batch already waits for a person.

import type { Env } from "./env.ts";
import type { CheckRun } from "./checks.ts";
import { adminsOnly, agentsUnavailable, hostedBudget, installedHarnesses } from "./agent-routes.ts";

/** Fix tasks a branch gets before it waits for a person. */
export const MAX_ATTEMPTS = 2;
/** How much of a failing log goes into the task. */
const LOG_CHARS = 1500;

/** Why no fix task starts for `owner`'s repos here, or null when one may. */
export function healUnavailable(env: Env, owner: string): string | null {
  if (env.HEAL === "off") return "self-healing is off (HEAL=off)";
  if (!env.AGENT_SANDBOX && env.HEAL !== "1") return "self-healing runs with hosted agents (CODESPLITTER_AGENTS=1), or on the desktop with HEAL=1";
  const why = agentsUnavailable(env);
  if (why) return why;
  if (adminsOnly(env, owner)) return "hosted fix tasks are limited to this site's admins (ADMINS)";
  if (!installedHarnesses(env).length) return "no coding agent's CLI is installed here";
  return null;
}

/** An open branch's fix tasks so far, oldest first: those started since it was made. */
async function attempts(env: Env, owner: string, repo: string, branch: string) {
  const open = await env.DB.prepare("SELECT created_at FROM branches WHERE owner = ? AND repo = ? AND name = ? AND status = 'open'").bind(owner, repo, branch).first();
  if (!open) return null;
  const { results } = await env.DB.prepare("SELECT id, path, harness, task, status, started, result FROM agent_runs WHERE owner = ? AND repo = ? AND branch = ? AND started >= ? ORDER BY id")
    .bind(owner, repo, branch, open.created_at as number).all();
  return { since: open.created_at as number, runs: results as { id: number; path: string; harness: string; task: string; status: string; started: number; result: string | null }[] };
}

/** What self-healing has done for `branch`, for its checks: the attempts, and whether it's a person's turn now. */
export async function heals(env: Env, owner: string, repo: string, branch: string) {
  const a = await attempts(env, owner, repo, branch);
  if (!a) return null;
  const list = a.runs.map((r) => {
    const x = r.result ? JSON.parse(r.result) as { applied?: number; error?: string } : {};
    return { id: r.id, path: r.path, harness: r.harness, status: r.status, started: r.started, why: r.task.split("\n")[0], ...(x.applied !== undefined && { applied: x.applied }), ...(x.error && { error: x.error }) };
  });
  const running = list.some((r) => r.status === "running");
  return { max: MAX_ATTEMPTS, attempts: list, running, gave_up: !running && list.length >= MAX_ATTEMPTS };
}

/**
 * Start a fix task on `branch`'s `path`, unless one's running there, the branch has had its
 * MAX_ATTEMPTS, or self-healing is off. Its id, or why not.
 */
export async function openFix(env: Env, owner: string, repo: string, branch: string, path: string, task: string): Promise<{ id: number } | { skipped: string }> {
  if (branch === "main" || /^agent-run-\d+$/.test(branch)) return { skipped: "not a branch self-healing works on" };
  const off = healUnavailable(env, owner);
  if (off) return { skipped: off };
  const a = await attempts(env, owner, repo, branch);
  if (!a) return { skipped: "no open branch" };
  if (a.runs.some((r) => r.status === "running")) return { skipped: "a fix task is running on it already" };
  if (a.runs.length >= MAX_ATTEMPTS) return { skipped: `it had ${MAX_ATTEMPTS} fix tasks: a person's turn` };
  const spent = await hostedBudget(env);
  if (spent) return { skipped: ((await spent.json()) as { error: string }).error };
  const harness = installedHarnesses(env)[0]!;
  // One statement, so two failures at once open one task, and never more than MAX_ATTEMPTS.
  const row = await env.DB.prepare(`INSERT INTO agent_runs (owner, repo, path, harness, task, agent, status, started, branch)
    SELECT ?, ?, ?, ?, ?, ?, 'running', ?, ? WHERE NOT EXISTS (SELECT 1 FROM agent_runs WHERE owner = ? AND repo = ? AND branch = ? AND status = 'running')
    AND (SELECT COUNT(*) FROM agent_runs WHERE owner = ? AND repo = ? AND branch = ? AND started >= ?) < ? RETURNING id`)
    .bind(owner, repo, path, harness, task.slice(0, 4000), `agent-${harness}`, Date.now(), branch, owner, repo, branch, owner, repo, branch, a.since, MAX_ATTEMPTS).first();
  if (!row) return { skipped: "another fix task got there first" };
  const id = row.id as number;
  // The queue runs it, as it does a hosted run: on the desktop too, in this process.
  await env.JOBS.send({ agent: id, origin: env.BETTER_AUTH_URL ?? "http://codesplitter.local" });
  return { id };
}

/** The branch's files a fix can edit: text it changed and still has, not yet merged. */
async function editable(env: Env, owner: string, repo: string, branch: string) {
  const { results } = await env.DB.prepare("SELECT path FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 AND deleted = 0 AND blob IS NULL ORDER BY path").bind(owner, repo, branch).all();
  return (results as { path: string }[]).map((r) => r.path);
}

/** The file a failing log is most likely about: the one it names most, else the first. */
export function blame(paths: string[], log: string) {
  let best = paths[0], most = 0;
  for (const p of paths) {
    const n = log.split(p).length - 1;
    if (n > most) { best = p; most = n; }
  }
  return best;
}

export function checkTask(run: Pick<CheckRun, "name" | "ref">, path: string, others: string[], log: string) {
  const tail = log.trim().slice(-LOG_CHARS);
  return [
    `Fix the failing check "${run.name}" on branch ${run.ref}: change ${path} so it passes.`,
    ...(others.length ? [`The branch also changes ${others.join(", ")}; only ${path} is in front of you.`] : []),
    `The end of its log:`, tail,
  ].join("\n");
}

export const guardTask = (branch: string, path: string, lints: string[]) => [
  `Merging branch ${branch} into main tripped a guard on ${path}: fix the branch's copy so it merges clean.`,
  ...lints.map((l) => `- ${l}`),
].join("\n");

/** A check finished on a branch (checks.ts): a required one that failed opens a fix task. */
export async function checkFailed(env: Env, run: CheckRun) {
  if (run.status !== "failed" || run.ref === "main") return null;
  const { get, refChecks } = await import("./checks.ts");
  // Only a failure the merge gate holds the branch on, and that's still current: the branch hasn't changed since.
  const c = await refChecks(env, run.owner, run.repo, run.ref);
  if (c.sha !== run.sha || !c.gate.failed.includes(run.name)) return null;
  const paths = await editable(env, run.owner, run.repo, run.ref);
  if (!paths.length) return null;
  const log = (await get(env, run.id))?.log ?? "";
  const path = blame(paths, log)!;
  return openFix(env, run.owner, run.repo, run.ref, path, checkTask(run, path, paths.filter((p) => p !== path), log));
}

/** A merge of `branch` was refused over `lint:` conflicts (branches.ts): a fix task on the first file that tripped one. */
export async function guardTripped(env: Env, owner: string, repo: string, branch: string, trips: { path: string; lints: string[] }[]) {
  const t = trips.find((x) => x.lints.length);
  return t ? openFix(env, owner, repo, branch, t.path, guardTask(branch, t.path, t.lints)) : null;
}
