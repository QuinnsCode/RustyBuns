// Checks: one place to see whether a change is good, wherever it ran. A check run
// is one record (migrations/0038_check_runs.sql): a name, the ref and sha it ran
// on, its runner and its status. Three things write them:
//
//   - our own runners (#463): a commit to main, a branch pushed upstream or pulled
//     from it, or someone pressing Run queues `desktop` or `container` runs, which a
//     runner picks up and reports on with PUT .../checks/:id;
//   - GitHub Actions: a sha the mirror sent up is watched, and its check runs and
//     commit statuses come back in as `github` runs (the cron polls; POST .../checks/github
//     polls now). Our own results can go the other way, as `codesplitters/<name>` statuses;
//   - anyone in the crew, by hand, with POST .../checks.
//
// The repo's setting says where they run: here, github or both. A GitHub mirror
// starts on github, and here is always on offer. GitHub is the backup, not a
// dependency: while the mirror finds it down, the desktop checks here instead,
// and a merge goes on our own checks passing, with GitHub's required ones
// deferred. When GitHub's back, the mirror pushes and its results come in on
// main. Required checks gate a merge, the way build-file changes wait for a
// person (branches.ts). Every run that starts or finishes is a `check_run`
// webhook, shaped like GitHub's.
//
//   GET  /api/repos/:o/:r/checks[?ref=]        the ref's runs (main by default) on its latest sha, and the merge gate
//   POST /api/repos/:o/:r/checks {ref, sha, name, runner?, status?}  record a run (the crew, or a runner)
//   POST /api/repos/:o/:r/checks/run {ref}     queue our own checks on a ref as it is now, whatever the setting (the crew)
//   POST /api/repos/:o/:r/checks/github {ref?}  fetch GitHub's results for the shas sent up now (the crew)
//   GET|PUT /api/repos/:o/:r/checks/settings   where checks run, which are required, and whether ours go to GitHub
//   GET  /api/repos/:o/:r/checks/:id           one run, with its log
//   PUT  /api/repos/:o/:r/checks/:id {status?, log?, append?, junit?}  a runner reports (the crew)
//   POST /api/repos/:o/:r/checks/:id/cancel    stop one of ours that's queued or running (the crew)

import { json, type Env } from "./env.ts";
import { githubToken, parseRepo } from "./github.ts";
import { emit } from "./hooks.ts";

export const RUNNERS = ["desktop", "container", "github"] as const;
export const STATUSES = ["queued", "running", "passed", "failed", "cancelled"] as const;
type Runner = (typeof RUNNERS)[number];
type Status = (typeof STATUSES)[number];
type Where = "here" | "github" | "both";

export interface CheckRun {
  id: number; owner: string; repo: string; ref: string; sha: string; name: string; runner: Runner; status: Status;
  started_at: number | null; finished_at: number | null; log: string; junit: string | null; url: string | null; external_id: string | null; created_at: number;
}

const DONE = new Set<Status>(["passed", "failed", "cancelled"]);
/** How long a sha sent up is polled for GitHub's results. */
const WATCH = 2 * 3600_000;
/** A log keeps its last this-many characters. */
const MAX_LOG = 256 * 1024;
const COLUMNS = "id, owner, repo, ref, sha, name, runner, status, started_at, finished_at, url, external_id, created_at";

/** owner/name on GitHub when the repo mirrors a GitHub repo, else null. */
async function githubOf(env: Env, owner: string, repo: string) {
  const r = await env.DB.prepare("SELECT mirror_url FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
  const url = r?.mirror_url as string | undefined;
  return url && /github\.com[:/]/i.test(url) ? parseRepo(url) : null;
}

export async function checkSettings(env: Env, owner: string, repo: string) {
  const s = await env.DB.prepare("SELECT run_where, required, post_statuses FROM check_settings WHERE owner = ? AND repo = ?").bind(owner, repo).first();
  const github = await githubOf(env, owner, repo);
  const where = (s?.run_where as Where | null) ?? (github ? "github" : null);
  // The mirror couldn't reach GitHub last time it tried: GitHub's checks can't run, so ours stand in.
  const m = github ? await env.DB.prepare("SELECT mirror_state, mirror_down_since FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first() : null;
  const offline = m?.mirror_state === "down";
  return {
    where, required: String(s?.required ?? "").split(",").map((x) => x.trim()).filter(Boolean), post_statuses: !!s?.post_statuses, github,
    offline, down_since: offline ? (m?.mirror_down_since as number | null) ?? null : null,
    /** Whether our own checks run: asked for, or standing in while GitHub is down. */
    here: where === "here" || where === "both" || (where === "github" && offline),
  };
}

/** GitHub's REST API with the owner's token. Tests stand a fake in with env.GITHUB_FETCH. */
async function gh(env: Env, owner: string, path: string, init: RequestInit = {}) {
  const t = await githubToken(env, owner).catch(() => null);
  const send = (env.GITHUB_FETCH as typeof fetch | undefined) ?? fetch;
  return send(`https://api.github.com${path}`, {
    ...init,
    headers: { accept: "application/vnd.github+json", "user-agent": "codesplitters", ...(t && { authorization: `Bearer ${t.token}` }), ...init.headers as Record<string, string> },
    signal: AbortSignal.timeout(15_000),
  });
}

/** A run, shaped like GitHub's check_run object. */
const shaped = (r: CheckRun) => ({
  id: r.id, name: r.name, head_sha: r.sha,
  status: r.status === "queued" ? "queued" : r.status === "running" ? "in_progress" : "completed",
  conclusion: r.status === "passed" ? "success" : r.status === "failed" ? "failure" : r.status === "cancelled" ? "cancelled" : null,
  started_at: r.started_at ? new Date(r.started_at).toISOString() : null,
  completed_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  html_url: r.url, check_suite: { head_branch: r.ref, head_sha: r.sha }, app: { slug: r.runner === "github" ? "github-actions" : "codesplitters" },
});

const get = (env: Env, id: number) => env.DB.prepare("SELECT * FROM check_runs WHERE id = ?").bind(id).first() as Promise<CheckRun | null>;

/** A run started or finished: the webhook, and (when asked for) our own result on GitHub. */
async function told(env: Env, run: CheckRun, action: "created" | "completed", by: string) {
  await emit(env, run.owner, run.repo, "check_run", by, { action, check_run: shaped(run) });
  if (run.runner !== "github") await postStatus(env, run).catch(() => null);
}

/** Our own run as a commit status on GitHub, `codesplitters/<name>`, when the owner turned that on. */
async function postStatus(env: Env, run: CheckRun) {
  const s = await checkSettings(env, run.owner, run.repo);
  if (!s.post_statuses || !s.github || !/^[0-9a-f]{40}$/.test(run.sha)) return;
  const state = run.status === "passed" ? "success" : run.status === "failed" ? "failure" : run.status === "cancelled" ? "error" : "pending";
  await gh(env, run.owner, `/repos/${s.github}/statuses/${run.sha}`, {
    method: "POST",
    body: JSON.stringify({ state, context: `codesplitters/${run.name}`, description: `${run.runner}: ${run.status}`.slice(0, 140) }),
  });
}

/** Record a run. Its webhook goes out; one that's finished already says so too. */
export async function recordRun(env: Env, r: { owner: string; repo: string; ref: string; sha: string; name: string; runner: Runner; status?: Status; url?: string | null; external_id?: string | null; started_at?: number | null; finished_at?: number | null }, by: string) {
  const now = Date.now(), status = r.status ?? "queued";
  const started = r.started_at ?? (status === "queued" ? null : now), finished = r.finished_at ?? (DONE.has(status) ? now : null);
  const res = await env.DB.prepare("INSERT INTO check_runs (owner, repo, ref, sha, name, runner, status, started_at, finished_at, url, external_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(r.owner, r.repo, r.ref, r.sha, r.name, r.runner, status, started, finished, r.url ?? null, r.external_id ?? null, now).first();
  const run = (await get(env, res!.id as number))!;
  await told(env, run, "created", by);
  if (DONE.has(status)) await told(env, run, "completed", by);
  return run;
}

/** Move a run on. Finishing it sends the `completed` webhook; a finished run stays finished. */
export async function updateRun(env: Env, run: CheckRun, u: { status?: Status; log?: string; append?: string; junit?: string; url?: string | null }, by: string) {
  if (DONE.has(run.status) && u.status && u.status !== run.status) return null;
  const status = u.status ?? run.status, now = Date.now();
  const log = (u.log ?? run.log + (u.append ?? "")).slice(-MAX_LOG);
  await env.DB.prepare("UPDATE check_runs SET status = ?, log = ?, junit = COALESCE(?, junit), url = COALESCE(?, url), started_at = COALESCE(started_at, ?), finished_at = COALESCE(finished_at, ?) WHERE id = ?")
    .bind(status, log, u.junit ?? null, u.url ?? null, status === "queued" ? null : now, DONE.has(status) ? now : null, run.id).run();
  const after = (await get(env, run.id))!;
  if (status !== run.status) {
    if (DONE.has(status)) await told(env, after, "completed", by);
    else if (run.runner !== "github") await postStatus(env, after).catch(() => null);
  }
  return after;
}

/**
 * Something new to check on `ref` at `sha` (a commit to main, a branch pushed or
 * pulled): queue our own checks if they run here, and watch GitHub's if they run there.
 */
export async function startChecks(env: Env, owner: string, repo: string, ref: string, sha: string, by: string) {
  try {
    const s = await checkSettings(env, owner, repo);
    if (s.here) await queueHere(env, owner, repo, ref, sha, by, s.where === "github" ? "GitHub is down, so this runs here instead. GitHub's checks run when the mirror catches up.\n" : "");
    if ((s.where === "github" || s.where === "both") && s.github) await watchGithub(env, owner, repo, ref, sha);
  } catch {
    // Checks never get in the way of what happened.
  }
}

/** Upstream's tip moved (the mirror pushed, or took upstream's commits): watch GitHub's results for it, when checks run there. */
export async function upstreamMoved(env: Env, owner: string, repo: string, ref: string, sha: string) {
  try {
    const s = await checkSettings(env, owner, repo);
    if ((s.where === "github" || s.where === "both") && s.github) await watchGithub(env, owner, repo, ref, sha);
  } catch {}
}

/** Our own checks on `ref` at `sha`: one `test` run, on this machine or in a container, for a runner to pick up. */
async function queueHere(env: Env, owner: string, repo: string, ref: string, sha: string, by: string, why = "") {
  const runner: Runner = typeof Bun !== "undefined" ? "desktop" : "container";
  const live = await env.DB.prepare("SELECT 1 FROM check_runs WHERE owner = ? AND repo = ? AND ref = ? AND sha = ? AND runner = ? AND status IN ('queued', 'running')").bind(owner, repo, ref, sha, runner).first();
  if (live) return;
  const run = await recordRun(env, { owner, repo, ref, sha, name: "test", runner }, by);
  if (why) await env.DB.prepare("UPDATE check_runs SET log = ? WHERE id = ?").bind(why, run.id).run();
}

/** A sha that went up to GitHub: poll it for its Actions results for a while. */
export async function watchGithub(env: Env, owner: string, repo: string, ref: string, sha: string) {
  if (!/^[0-9a-f]{40}$/.test(sha)) return;
  await env.DB.prepare("INSERT INTO check_watches (owner, repo, ref, sha, until) VALUES (?, ?, ?, ?, ?) ON CONFLICT (owner, repo, sha) DO UPDATE SET ref = excluded.ref, until = excluded.until")
    .bind(owner, repo, ref, sha, Date.now() + WATCH).run();
}

/** GitHub's check-run and commit-status states, as ours. */
const fromCheckRun = (c: { status: string; conclusion: string | null }): Status =>
  c.status !== "completed" ? (c.status === "in_progress" ? "running" : "queued")
  : c.conclusion === "cancelled" ? "cancelled"
  : ["success", "neutral", "skipped"].includes(c.conclusion ?? "") ? "passed" : "failed";
const fromState = (s: string): Status => s === "success" ? "passed" : s === "pending" ? "running" : "failed";

/**
 * Bring GitHub's results for one sha in: each check run (Actions jobs) and commit
 * status (other CI), as a `github` run, added once and updated after. Our own
 * statuses, echoed back, are skipped. Says whether they've all finished.
 */
export async function importGithub(env: Env, owner: string, repo: string, ref: string, sha: string) {
  const github = await githubOf(env, owner, repo);
  if (!github) return { error: "this repo doesn't mirror a GitHub repo" };
  const [runs, statuses] = await Promise.all([
    gh(env, owner, `/repos/${github}/commits/${sha}/check-runs?per_page=100`),
    gh(env, owner, `/repos/${github}/commits/${sha}/status?per_page=100`),
  ]);
  if (!runs.ok) return { error: `GitHub said ${runs.status} for ${sha.slice(0, 7)}'s check runs` };
  const jobs = [
    ...((await runs.json()) as { check_runs?: any[] }).check_runs?.map((c) => ({
      external_id: `run:${c.id}`, name: String(c.name), status: fromCheckRun(c), url: c.html_url ?? null,
      started_at: c.started_at ? Date.parse(c.started_at) : null, finished_at: c.completed_at ? Date.parse(c.completed_at) : null,
    })) ?? [],
    ...(statuses.ok ? ((await statuses.json()) as { statuses?: any[] }).statuses ?? [] : [])
      .filter((s) => !String(s.context).startsWith("codesplitters/"))
      .map((s) => ({
        external_id: `status:${s.context}`, name: String(s.context), status: fromState(s.state), url: s.target_url ?? null,
        started_at: s.created_at ? Date.parse(s.created_at) : null, finished_at: s.state !== "pending" && s.updated_at ? Date.parse(s.updated_at) : null,
      })),
  ];
  for (const j of jobs) {
    const had = await env.DB.prepare("SELECT * FROM check_runs WHERE owner = ? AND repo = ? AND sha = ? AND external_id = ?").bind(owner, repo, sha, j.external_id).first() as CheckRun | null;
    if (!had) await recordRun(env, { owner, repo, ref, sha, runner: "github", ...j }, "github");
    else if (had.status !== j.status || had.url !== j.url) await updateRun(env, had, { status: j.status, url: j.url }, "github");
  }
  return { sha, imported: jobs.length, done: jobs.length > 0 && jobs.every((j) => DONE.has(j.status)) };
}

/** The cron: every watched sha, once more. Ones whose jobs have all finished, or whose time is up, stop being watched. */
export async function pollGithub(env: Env, now = Date.now()) {
  const { results } = await env.DB.prepare("SELECT owner, repo, ref, sha, until FROM check_watches").all();
  for (const w of results as { owner: string; repo: string; ref: string; sha: string; until: number }[]) {
    const r = await importGithub(env, w.owner, w.repo, w.ref, w.sha).catch(() => null);
    if ((r && "done" in r && r.done) || (r && "error" in r && !(await githubOf(env, w.owner, w.repo))) || w.until <= now)
      await env.DB.prepare("DELETE FROM check_watches WHERE owner = ? AND repo = ? AND sha = ?").bind(w.owner, w.repo, w.sha).run();
  }
}

/**
 * A ref's checks: the runs on its latest sha (the newest of each name), and whether
 * a merge may go. A required check that hasn't run, or is still going, holds it;
 * one that failed or was cancelled blocks it. `*` requires every check that ran.
 * While GitHub is down, a required check only GitHub runs is deferred, not waited
 * on, once our own checks on the sha have all passed: work carries on, and GitHub's
 * verdict comes in on main when it's back.
 */
export async function refChecks(env: Env, owner: string, repo: string, ref: string) {
  const s = await checkSettings(env, owner, repo);
  const head = await env.DB.prepare("SELECT sha FROM check_runs WHERE owner = ? AND repo = ? AND ref = ? ORDER BY id DESC LIMIT 1").bind(owner, repo, ref).first();
  const sha = (head?.sha as string | undefined) ?? null;
  const { results } = sha
    ? await env.DB.prepare(`SELECT ${COLUMNS} FROM check_runs WHERE owner = ? AND repo = ? AND ref = ? AND sha = ? ORDER BY id`).bind(owner, repo, ref, sha).all()
    : { results: [] };
  const latest = new Map<string, Omit<CheckRun, "log" | "junit">>();
  for (const r of results as CheckRun[]) latest.set(r.name, r);
  const runs = [...latest.values()];
  const wanted = s.required.includes("*") ? (runs.length ? runs.map((r) => r.name) : ["*"]) : s.required;
  const passed: string[] = [], waiting: string[] = [], failed: string[] = [], deferred: string[] = [];
  const ours = runs.filter((r) => r.runner !== "github"), oursPassed = ours.length > 0 && ours.every((r) => r.status === "passed");
  for (const name of new Set(wanted)) {
    const r = latest.get(name);
    if (r?.status === "passed") passed.push(name);
    else if (r && DONE.has(r.status)) failed.push(name);
    else if (s.offline && oursPassed && (!r || r.runner === "github")) deferred.push(name);
    else waiting.push(name);
  }
  return {
    ref, sha, where: s.where, here: s.here, offline: s.offline, runs,
    gate: { required: s.required, ok: !waiting.length && !failed.length, passed, waiting, failed, deferred },
  };
}

/** Why a merge of `ref` has to wait for its checks, or null when it doesn't. */
export async function mergeBlock(env: Env, owner: string, repo: string, ref: string) {
  const c = await refChecks(env, owner, repo, ref);
  if (c.gate.ok) return null;
  const why = [c.gate.failed.length && `${c.gate.failed.join(", ")} failed`, c.gate.waiting.length && `waiting on ${c.gate.waiting.join(", ")}`].filter(Boolean).join("; ");
  const tip = c.offline && c.gate.waiting.length ? ". GitHub is down: run checks here, and once they pass, GitHub's wait until it's back" : "";
  return { error: `required checks haven't passed: ${why}${tip}`, checks: c.gate };
}

/** What `ref` is in git right now, to run checks on: main's commit, or the commit a branch last went upstream as. */
async function headOf(env: Env, owner: string, repo: string, ref: string): Promise<string> {
  if (ref === "main") {
    const r = await env.DB.prepare("SELECT upstream_commit FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
    const { handleFor, listDir } = await import("./archive.ts");
    const h = await handleFor(env, owner, repo).catch(() => null);
    const listing = h && await listDir(env, h.handle, h.branch, "").catch(() => null);
    return listing?.commit?.hash ?? (r?.upstream_commit as string | null) ?? "";
  }
  const pushed = await env.DB.prepare("SELECT sha FROM check_watches WHERE owner = ? AND repo = ? AND ref = ? ORDER BY until DESC LIMIT 1").bind(owner, repo, ref).first();
  // A branch that hasn't gone up as a git commit is checked as it is here, at this moment.
  return (pushed?.sha as string | undefined) ?? `${ref}@${Date.now()}`;
}

interface Access { read: boolean; write: boolean }

export async function checkRoutes(req: Request, env: Env, p: string[], url: URL, owner: string, repo: string, user: string | null, a: Access): Promise<Response | null> {
  if (p[4] !== "checks") return null;
  const body = async <T>() => (await req.json().catch(() => ({}))) as T;
  const crew = () => a.write ? null : json({ error: "no write access" }, 403);

  if (!p[5] && req.method === "GET") return json(await refChecks(env, owner, repo, url.searchParams.get("ref") || "main"));
  if (!p[5] && req.method === "POST") {
    const no = crew(); if (no) return no;
    const b = await body<{ ref?: string; sha?: string; name?: string; runner?: Runner; status?: Status; url?: string }>();
    if (!b.ref || !b.sha || !b.name || b.name.length > 100) return json({ error: "ref, sha and name, please" }, 400);
    if (b.runner && !RUNNERS.includes(b.runner)) return json({ error: `runner: one of ${RUNNERS.join(", ")}` }, 400);
    if (b.status && !STATUSES.includes(b.status)) return json({ error: `status: one of ${STATUSES.join(", ")}` }, 400);
    return json(await recordRun(env, { owner, repo, ref: b.ref, sha: b.sha, name: b.name, runner: b.runner ?? "desktop", status: b.status, url: b.url }, user!), 201);
  }
  if (p[5] === "run" && req.method === "POST") {
    const no = crew(); if (no) return no;
    const { ref = "main" } = await body<{ ref?: string }>();
    // Running here is always on offer, whatever the setting: local first, GitHub as the backup.
    if (ref !== "main" && !(await env.DB.prepare("SELECT 1 FROM branches WHERE owner = ? AND repo = ? AND name = ? AND status = 'open'").bind(owner, repo, ref).first())) return json({ error: "no open branch " + ref }, 404);
    const sha = await headOf(env, owner, repo, ref);
    if (!sha) return json({ error: "main has no commit yet" }, 409);
    await queueHere(env, owner, repo, ref, sha, user!);
    return json(await refChecks(env, owner, repo, ref), 202);
  }
  if (p[5] === "github" && req.method === "POST") {
    const no = crew(); if (no) return no;
    const { ref } = await body<{ ref?: string }>();
    const { results } = await env.DB.prepare(`SELECT ref, sha FROM check_watches WHERE owner = ? AND repo = ?${ref ? " AND ref = ?" : ""}`).bind(...[owner, repo, ...(ref ? [ref] : [])]).all();
    const out = [];
    for (const w of results as { ref: string; sha: string }[]) out.push(await importGithub(env, owner, repo, w.ref, w.sha));
    return json({ polled: out });
  }
  if (p[5] === "settings" && req.method === "GET") return json(await checkSettings(env, owner, repo));
  if (p[5] === "settings" && req.method === "PUT") {
    if (user !== owner) return json({ error: "owner only" }, 403);
    const b = await body<{ where?: Where | null; required?: string[]; post_statuses?: boolean }>();
    if (b.where != null && !["here", "github", "both"].includes(b.where)) return json({ error: "where: here, github or both" }, 400);
    if (b.required !== undefined && (!Array.isArray(b.required) || b.required.some((n) => typeof n !== "string" || !n.trim() || n.includes(",")))) return json({ error: "required: a list of check names, or [\"*\"] for all" }, 400);
    const now = await checkSettings(env, owner, repo);
    const had = await env.DB.prepare("SELECT run_where FROM check_settings WHERE owner = ? AND repo = ?").bind(owner, repo).first();
    await env.DB.prepare("INSERT INTO check_settings (owner, repo, run_where, required, post_statuses) VALUES (?, ?, ?, ?, ?) ON CONFLICT (owner, repo) DO UPDATE SET run_where = excluded.run_where, required = excluded.required, post_statuses = excluded.post_statuses")
      .bind(owner, repo, b.where !== undefined ? b.where : (had?.run_where ?? null), (b.required ?? now.required).map((n) => n.trim()).join(","), (b.post_statuses ?? now.post_statuses) ? 1 : 0).run();
    return json(await checkSettings(env, owner, repo));
  }

  const id = Number(p[5]);
  const run = Number.isInteger(id) && id > 0 ? await get(env, id) : null;
  if (!run || run.owner !== owner || run.repo !== repo) return json({ error: "no such check run" }, 404);
  if (!p[6] && req.method === "GET") return json(run);
  if (!p[6] && req.method === "PUT") {
    const no = crew(); if (no) return no;
    const b = await body<{ status?: Status; log?: string; append?: string; junit?: string }>();
    if (b.status && !STATUSES.includes(b.status)) return json({ error: `status: one of ${STATUSES.join(", ")}` }, 400);
    if (run.runner === "github") return json({ error: "GitHub's runs come from GitHub" }, 409);
    const after = await updateRun(env, run, b, user!);
    return after ? json(after) : json({ error: `it's ${run.status} already` }, 409);
  }
  if (p[6] === "cancel" && req.method === "POST") {
    const no = crew(); if (no) return no;
    if (run.runner === "github") return json({ error: `cancel it on GitHub${run.url ? `: ${run.url}` : ""}` }, 409);
    if (DONE.has(run.status)) return json({ error: `it's ${run.status} already` }, 409);
    return json(await updateRun(env, run, { status: "cancelled", append: `\ncancelled by ${user}\n` }, user!));
  }
  return null;
}
