// Layout: checks: runs, the merge gate, what runs here (per workspace in a monorepo), the claim protocol, GitHub's results
// Checks: one place to see whether a change is good, wherever it ran. A check run
// is one record (migrations/0038_check_runs.sql): a name, the ref and sha it ran
// on, its runner and its status. Four things write them:
//
//   - our own runners (#463): a commit to main, a branch pushed upstream or pulled
//     from it, or someone pressing Run queues `desktop` or `container` runs, which a
//     runner picks up and reports on with PUT .../checks/:id;
//   - GitHub Actions: a sha the mirror sent up is watched, and its check runs and
//     commit statuses come back in as `github` runs (the cron polls; POST .../checks/github
//     polls now). Our own results can go the other way, as `codesplitter/<name>` statuses;
//   - anyone in the crew, by hand, with POST .../checks: labelled so, and only the owner's
//     may say how it went (a collaborator's is queued, for a runner to claim);
//   - other CI, through the GitHub-shaped API under /api/gh/v3 with a repo's CI token,
//     as `external` runs (gh-compat.ts);
//   - a runner of your own, wherever it lives (#534): it pulls work rather than being
//     pushed to, so it can sit behind a firewall or on a laptop. POST .../checks/claim
//     takes the oldest queued run, PUT .../checks/:id streams its log and finishes it,
//     and each PUT is a heartbeat: a claimed run nobody's heard from in STALE goes back
//     in the queue. scripts/runner.ts is the loop, to wrap around any build.
//
// The repo's setting says where they run: here, github or both. A GitHub mirror
// starts on github, and here is always on offer. GitHub is the backup, not a
// dependency: while the mirror finds it down, the desktop checks here instead,
// and a merge goes on our own checks passing, with GitHub's required ones
// deferred. When GitHub's back, the mirror pushes and its results come in on
// main. Required checks gate a merge, the way build-file changes wait for a
// person (branches.ts). A required check can name paths: it's required only on a
// branch that touches one of them, so a change in apps/a doesn't wait on b-tests.
// One with a command is queued here too, for a runner to claim. Only whoever claimed a run, or the
// owner, says how it went, so a collaborator (an agent too) can't pass a check it didn't run (#645).
//
// What runs here (#463): the required checks with a command, then the repo's own list, read at
// the ref: a `codesplitter.ci` file at the top, {"<name>": "<command>" | {run, paths?}}, any
// command at all (a `docker build .` runs on whoever's machine claims it), else package.json's
// `test` and `typecheck` scripts, else one `test` run with the runner's default command.
// The `pinned` setting (#1010) drops all of that read at the ref: only the required checks with a
// command run, and a claim hands out a command from the settings or none at all, so a merged
// edit to codesplitter.ci or package.json can't change the job that runs on someone's machine.
// A monorepo (package.json `workspaces`) checks per workspace instead (#750): each one's own
// `test` and `typecheck`, run in its folder as `<folder>:test`, and only when the change touches
// that folder, a workspace it depends on (by package name, followed through theirs), the root
// package.json or a lockfile: a change in apps/a runs a's tests, not b's, and one in a library
// both use runs both. The root `typecheck` stays, repo-wide.
//
// Who runs them (#750): a runner of your own; the desktop app, which drains its own queue
// in-process; or on Cloudflare, with CI_RUNNER bound, a container per run (src/ci-runner.ts).
// A commit's runs take the place of the ref's runs still queued on an older commit.
//
// A branch knows when it last changed (#489): its file copies stamp `changed_at` on every edit,
// and runs on the branch from before that are stale, so the gate waits again. When checks run
// here, an edit queues a run of each check that hasn't one queued already: a run waiting in the
// queue reads the branch as it is when it's claimed, so a burst of edits makes one run, not many.
// A branch that hasn't gone up as a git commit is checked at `<branch>@<time>`: the runner
// clones main and lays the branch's files over it (scripts/runner.ts).
//
// A run nobody claims in UNCLAIMED (no runner, or one that's offline) is cancelled by the
// hourly cron, its log saying so, rather than waiting on the gate forever (#490).
// Every run that starts or finishes is a `check_run`
// webhook, shaped like GitHub's.
//
//   GET  /api/repos/:o/:r/checks[?ref=]        the ref's runs (main by default) on its latest sha, and the merge gate
//   POST /api/repos/:o/:r/checks {ref, sha, name, runner?, status?}  record a run by hand (the crew queues one; the owner may say how it went)
//   POST /api/repos/:o/:r/checks/run {ref}     queue our own checks on a ref as it is now, whatever the setting (the crew)
//   POST /api/repos/:o/:r/checks/github {ref?}  fetch GitHub's results for the shas sent up now (the crew)
//   POST /api/repos/:o/:r/checks/claim {runner_label, names?}  a runner takes the oldest queued run, or a 204 (the crew)
//   GET|PUT /api/repos/:o/:r/checks/settings   where checks run, which are required, whether ours go to GitHub, and whether only the settings' commands run
//   GET  /api/repos/:o/:r/checks/:id           one run, with its log
//   PUT  /api/repos/:o/:r/checks/:id {status?, log?, append?, junit?, runner_label?}  a runner reports, and says it's alive (whoever claimed it, or the owner)
//   POST /api/repos/:o/:r/checks/:id/cancel    stop one of ours that's queued or running (the crew)

import { json, readBody, type Env } from "./env.ts";
import { githubToken, parseRepo } from "./github.ts";
import { emit } from "./hooks.ts";

export const RUNNERS = ["desktop", "container", "github", "external"] as const;
export const STATUSES = ["queued", "running", "passed", "failed", "cancelled"] as const;
export type Runner = (typeof RUNNERS)[number];
export type Status = (typeof STATUSES)[number];
type Where = "here" | "github" | "both";

export interface CheckRun {
  id: number; owner: string; repo: string; ref: string; sha: string; name: string; runner: Runner; status: Status;
  started_at: number | null; finished_at: number | null; log: string; junit: string | null; url: string | null; external_id: string | null; created_at: number;
  runner_label: string | null; heartbeat_at: number | null; claimed_by: string | null; command: string | null;
}

/** A check a merge waits on: on every branch, or only on one that touches `paths`. One with a `command` is queued for our runners. */
export interface Required { name: string; paths?: string[]; command?: string }

export const DONE = new Set<Status>(["passed", "failed", "cancelled"]);
/** How long a sha sent up is polled for GitHub's results. */
const WATCH = 2 * 3600_000;
/** A log keeps its last this-many characters. */
const MAX_LOG = 256 * 1024;
/** A claimed run whose runner hasn't been heard from in this long goes back in the queue. */
export const STALE = 10 * 60_000;
/** A run of ours still queued after this long has no runner coming for it: the cron cancels it. */
export const UNCLAIMED = 6 * 3600_000;
const COLUMNS = "id, owner, repo, ref, sha, name, runner, status, started_at, finished_at, url, external_id, created_at, runner_label";

/** The setting as stored: JSON, or the comma-separated names it used to be. */
const parseRequired = (raw: string): Required[] => {
  if (raw.trim().startsWith("[")) { try { return JSON.parse(raw); } catch { return []; } }
  return raw.split(",").map((x) => x.trim()).filter(Boolean).map((name) => ({ name }));
};

/** Whether `path` falls under `pattern`: a directory or file (`apps/a`), or a glob (`*` within a segment, `**` across them). */
export function pathMatches(pattern: string, path: string) {
  const p = pattern.replace(/^\.?\//, "");
  if (!/[*?]/.test(p)) { const d = p.replace(/\/+$/, ""); return path === d || path.startsWith(d + "/"); }
  const re = p.split(/(\*\*\/?|\*|\?)/).map((x) =>
    x === "**/" ? "(?:.*/)?" : x === "**" ? ".*" : x === "*" ? "[^/]*" : x === "?" ? "[^/]" : x.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("");
  return new RegExp(`^${re}$`).test(path);
}

/** The required checks that apply when `paths` changed: all but those whose paths it misses. null, not knowing what changed (main), is all of them. */
export const requiredFor = (required: Required[], paths: string[] | null) =>
  required.filter((r) => !r.paths?.length || !paths || paths.some((f) => r.paths!.some((p) => pathMatches(p, f))));

/** The files a branch touches, or null for main or a ref that isn't a branch. */
async function touched(env: Env, owner: string, repo: string, ref: string) {
  if (ref === "main" || !(await env.DB.prepare("SELECT 1 FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, ref).first())) return null;
  const { results } = await env.DB.prepare("SELECT path FROM branch_files WHERE owner = ? AND repo = ? AND branch = ?").bind(owner, repo, ref).all();
  return results.map((r: any) => r.path as string);
}

/** owner/name on GitHub when the repo mirrors a GitHub repo, else null. */
async function githubOf(env: Env, owner: string, repo: string) {
  const r = await env.DB.prepare("SELECT mirror_url FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
  const url = r?.mirror_url as string | undefined;
  return url && /github\.com[:/]/i.test(url) ? parseRepo(url) : null;
}

export async function checkSettings(env: Env, owner: string, repo: string) {
  const s = await env.DB.prepare("SELECT run_where, required, post_statuses, pinned FROM check_settings WHERE owner = ? AND repo = ?").bind(owner, repo).first();
  const github = await githubOf(env, owner, repo);
  const where = (s?.run_where as Where | null) ?? (github ? "github" : null);
  // The mirror couldn't reach GitHub last time it tried: GitHub's checks can't run, so ours stand in.
  const m = github ? await env.DB.prepare("SELECT mirror_state, mirror_down_since FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first() : null;
  const offline = m?.mirror_state === "down";
  return {
    where, required: parseRequired(String(s?.required ?? "")), post_statuses: !!s?.post_statuses, github,
    /** Only the settings' commands run: codesplitter.ci and package.json at the ref are ignored (#1010). */
    pinned: !!s?.pinned,
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
    headers: { accept: "application/vnd.github+json", "user-agent": "codesplitter", ...(t && { authorization: `Bearer ${t.token}` }), ...init.headers as Record<string, string> },
    signal: AbortSignal.timeout(15_000),
  });
}

/** A run, shaped like GitHub's check_run object. */
export const shaped = (r: CheckRun) => ({
  id: r.id, name: r.name, head_sha: r.sha,
  status: r.status === "queued" ? "queued" : r.status === "running" ? "in_progress" : "completed",
  conclusion: r.status === "passed" ? "success" : r.status === "failed" ? "failure" : r.status === "cancelled" ? "cancelled" : null,
  started_at: r.started_at ? new Date(r.started_at).toISOString() : null,
  completed_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  html_url: r.url, check_suite: { head_branch: r.ref, head_sha: r.sha }, app: { slug: r.runner === "github" ? "github-actions" : "codesplitter" },
});

export const get = (env: Env, id: number) => env.DB.prepare("SELECT * FROM check_runs WHERE id = ?").bind(id).first() as Promise<CheckRun | null>;

/** A run started or finished: the webhook, (when asked for) our own result on GitHub, and a failure on a branch its fix task (heal.ts). */
async function told(env: Env, run: CheckRun, action: "created" | "completed", by: string) {
  await emit(env, run.owner, run.repo, "check_run", by, { action, check_run: shaped(run) });
  if (run.runner !== "github") await postStatus(env, run).catch(() => null);
  if (action === "completed" && run.status === "failed" && run.ref !== "main") await (await import("./heal.ts")).checkFailed(env, run).catch(() => null);
}

/** The status context we post our runs under. */
const CONTEXT = "codesplitter/";

/** Our own run as a commit status on GitHub, when the owner turned that on. */
async function postStatus(env: Env, run: CheckRun) {
  const s = await checkSettings(env, run.owner, run.repo);
  if (!s.post_statuses || !s.github || !/^[0-9a-f]{40}$/.test(run.sha)) return;
  const state = run.status === "passed" ? "success" : run.status === "failed" ? "failure" : run.status === "cancelled" ? "error" : "pending";
  await gh(env, run.owner, `/repos/${s.github}/statuses/${run.sha}`, {
    method: "POST",
    body: JSON.stringify({ state, context: `${CONTEXT}${run.name}`, description: `${run.runner}: ${run.status}`.slice(0, 140) }),
  });
}

/** Record a run. Its webhook goes out; one that's finished already says so too. */
export async function recordRun(env: Env, r: { owner: string; repo: string; ref: string; sha: string; name: string; runner: Runner; status?: Status; url?: string | null; external_id?: string | null; started_at?: number | null; finished_at?: number | null; runner_label?: string | null; command?: string | null }, by: string) {
  const now = Date.now(), status = r.status ?? "queued";
  const started = r.started_at ?? (status === "queued" ? null : now), finished = r.finished_at ?? (DONE.has(status) ? now : null);
  const res = await env.DB.prepare("INSERT INTO check_runs (owner, repo, ref, sha, name, runner, status, started_at, finished_at, url, external_id, created_at, runner_label, command) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(r.owner, r.repo, r.ref, r.sha, r.name, r.runner, status, started, finished, r.url ?? null, r.external_id ?? null, now, r.runner_label ?? null, r.command ?? null).first();
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
  await env.DB.prepare("UPDATE check_runs SET status = ?, log = ?, junit = COALESCE(?, junit), url = COALESCE(?, url), started_at = COALESCE(started_at, ?), finished_at = COALESCE(finished_at, ?), heartbeat_at = ? WHERE id = ?")
    .bind(status, log, u.junit ?? null, u.url ?? null, status === "queued" ? null : now, DONE.has(status) ? now : null, now, run.id).run();
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

/** The mirror took upstream's commits onto `ref`, now at `sha` here: run our own checks on them, when checks run here. */
export async function upstreamTaken(env: Env, owner: string, repo: string, ref: string, sha: string) {
  try {
    if ((await checkSettings(env, owner, repo)).here) await queueHere(env, owner, repo, ref, sha, "upstream");
  } catch {}
}

/** A file's text on `ref` (the branch's copy when it has one, else main's), or null when there's none. */
export async function readAt(env: Env, owner: string, repo: string, ref: string, path: string) {
  const { materialize, toFile } = await import("./archive.ts");
  const own = ref === "main" ? null : await env.DB.prepare("SELECT deleted FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND path = ? AND merged = 0").bind(owner, repo, ref, path).first();
  if (own?.deleted) return null;
  if (!own && "error" in await materialize(env, owner, repo, path)) return null;
  const res = await toFile(env, owner, repo, path, "upstream", "file", {}, "", own ? ref : undefined);
  return res.ok ? ((await res.json()) as { lines: { text: string }[] }).lines.map((l) => l.text).join("\n") : null;
}

/** A check the repo runs, from its codesplitter.ci or package.json. */
export interface Planned { name: string; command: string; paths?: string[] }

const parse = (t: string | null) => { try { const v = t && JSON.parse(t); return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { return null; } };
const SCRIPTS = ["test", "typecheck"];
const scriptsOf = (pkg: string | null) => {
  const s = parse(pkg)?.scripts as Record<string, unknown> | undefined;
  return SCRIPTS.filter((n) => typeof s?.[n] === "string");
};
/** Files that, changed, can break any workspace: the root package.json and the lockfiles. */
const LOCKFILES = ["package.json", "bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"];
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A package.json's workspace patterns (an array, or yarn's {packages}). */
export function workspacePatterns(pkg: string | null): string[] {
  const w = parse(pkg)?.workspaces as unknown;
  const list = Array.isArray(w) ? w : Array.isArray((w as { packages?: unknown })?.packages) ? (w as { packages: unknown[] }).packages : [];
  return list.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.replace(/^\.\//, "").replace(/\/+$/, ""));
}

/**
 * How a fresh clone gets its dependencies before a package.json plan runs (#775), from the
 * files at the repo's root: frozen to bun's lockfile when there is one. Plans run with bun, and
 * bun reads npm's, yarn's and pnpm's lockfiles too, so it installs those repos as well.
 */
export const installFor = (top: string[]) => top.includes("bun.lock") || top.includes("bun.lockb") ? "bun install --frozen-lockfile" : "bun install";

/**
 * The repo's own checks, as `codesplitter.ci` says ({name: command | {run, paths?}}), else
 * per workspace when `workspaces` (each one's folder and package.json) have scripts of their
 * own, else package.json's test and typecheck scripts. Those two start with `install`, at the
 * root, when given: a runner's clone has no node_modules. A codesplitter.ci's commands run as written.
 */
export function planFrom(ci: string | null, pkg: string | null, workspaces: { dir: string; pkg: string | null }[] = [], install?: string): Planned[] {
  const conf = parse(ci);
  if (conf) return Object.entries(conf).flatMap(([name, v]): Planned[] => {
    const c = typeof v === "string" ? { run: v } : v as { run?: unknown; paths?: unknown };
    if (!name.trim() || name.includes(",") || name.length > 100 || typeof c?.run !== "string" || !c.run.trim() || c.run.length > 1000) return [];
    const paths = Array.isArray(c.paths) ? c.paths.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
    return [{ name: name.trim(), command: c.run, ...(paths.length && { paths }) }];
  });
  const first = install ? `${install} && ` : "";
  const own = workspaces.map((w) => {
    const j = parse(w.pkg);
    const deps = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((k) => Object.keys((j?.[k] as object | undefined) ?? {}));
    return { dir: w.dir, name: typeof j?.name === "string" ? j.name : null, deps, scripts: scriptsOf(w.pkg) };
  });
  if (own.some((w) => w.scripts.length)) {
    const byName = new Map(own.filter((w) => w.name).map((w) => [w.name!, w]));
    // The workspaces `w` uses, and what they use in turn: a change in any of them can break it.
    const uses = (w: (typeof own)[number]) => {
      const seen = new Set<string>([w.dir]);
      const walk = (x: typeof w) => { for (const d of x.deps) { const y = byName.get(d); if (y && !seen.has(y.dir)) { seen.add(y.dir); walk(y); } } };
      walk(w);
      return [...seen];
    };
    return [
      ...own.flatMap((w) => w.scripts.map((n) => ({ name: `${w.dir}:${n}`, command: `${first}cd ${quote(w.dir)} && bun run ${n}`, paths: [...uses(w), ...LOCKFILES] }))),
      ...scriptsOf(pkg).filter((n) => n === "typecheck").map((n) => ({ name: n, command: `${first}bun run ${n}` })),
    ].filter((p) => p.name.length <= 100 && !p.name.includes(","));
  }
  return scriptsOf(pkg).map((n) => ({ name: n, command: `${first}bun run ${n}` }));
}

/** The folders `patterns` name on `ref`: a folder as is, or `dir/*`'s subfolders (on main, and any a branch adds). Other globs aren't followed. */
async function workspaceDirs(env: Env, owner: string, repo: string, ref: string, patterns: string[]) {
  const { handleFor, listDir } = await import("./archive.ts");
  const h = await handleFor(env, owner, repo).catch(() => null);
  const added = ref === "main" ? [] : ((await env.DB.prepare("SELECT path FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 AND deleted = 0").bind(owner, repo, ref).all()).results as { path: string }[]).map((r) => r.path);
  const dirs = new Set<string>();
  for (const p of patterns) {
    if (!/[*?[]/.test(p)) { dirs.add(p); continue; }
    const m = p.match(/^([^*?[]*?)\/?\*$/);
    if (!m) continue;
    const parent = m[1]!;
    const listing = h ? await listDir(env, h.handle, h.branch, parent).catch(() => null) : null;
    for (const e of listing?.entries ?? []) if (e.type === "dir") dirs.add(e.path);
    const under = parent ? `${parent}/` : "";
    for (const f of added) {
      const [name, file, ...more] = f.startsWith(under) ? f.slice(under.length).split("/") : [];
      if (name && file === "package.json" && !more.length) dirs.add(under + name);
    }
  }
  return [...dirs].sort().slice(0, 100);
}

/** The files at the root of `ref`: main's, with the ones a branch adds or deletes there. */
async function rootFiles(env: Env, owner: string, repo: string, ref: string) {
  const { handleFor, listDir } = await import("./archive.ts");
  const h = await handleFor(env, owner, repo).catch(() => null);
  const listing = h ? await listDir(env, h.handle, h.branch, "").catch(() => null) : null;
  const names = new Set((listing?.entries ?? []).filter((e) => e.type === "file").map((e) => e.name));
  if (ref !== "main") {
    const { results } = await env.DB.prepare("SELECT path, deleted FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 AND path NOT LIKE '%/%'").bind(owner, repo, ref).all();
    for (const r of results as { path: string; deleted: number }[]) r.deleted ? names.delete(r.path) : names.add(r.path);
  }
  return [...names];
}

/** The repo's codesplitter.ci. */
const readCi = (env: Env, owner: string, repo: string, ref: string) => readAt(env, owner, repo, ref, "codesplitter.ci").catch(() => null);

/** What runs here on `ref`, given what it touched: each required check with a command, then the repo's own, by name. Pinned, only the former. */
export async function planChecks(env: Env, owner: string, repo: string, ref: string, required: Required[], paths: string[] | null, pinned = false) {
  if (pinned) return requiredFor(required.filter((r) => r.command && r.name !== "*"), paths).map(({ name, command }) => ({ name, command }));
  const [ci, pkg] = await Promise.all([readCi(env, owner, repo, ref), readAt(env, owner, repo, ref, "package.json").catch(() => null)]);
  // A monorepo without its own codesplitter.ci: each workspace's package.json, to plan per workspace.
  const patterns = parse(ci ?? null) ? [] : workspacePatterns(pkg ?? null);
  const workspaces = patterns.length ? await Promise.all((await workspaceDirs(env, owner, repo, ref, patterns)).map(async (dir) => ({ dir, pkg: await readAt(env, owner, repo, ref, `${dir}/package.json`).catch(() => null) }))) : [];
  const ours = new Map<string, { name: string; command?: string }>();
  for (const r of requiredFor(required.filter((r) => r.command && r.name !== "*"), paths)) ours.set(r.name, r);
  const install = parse(ci ?? null) || !pkg ? undefined : installFor(await rootFiles(env, owner, repo, ref).catch(() => []));
  for (const r of requiredFor(planFrom(ci ?? null, pkg ?? null, workspaces, install), paths)) if (!ours.has(r.name)) ours.set(r.name, r);
  return ours.size ? [...ours.values()] : [{ name: "test" }];
}

/**
 * Our own checks on `ref` at `sha`, on this machine or in a container, for a runner to
 * claim: what planChecks says the ref's changes call for. One that's queued or running
 * already isn't queued again; after an edit, one queued at all on the ref isn't. A new
 * commit's runs cancel the ones still queued on an older one: nobody reads those.
 * Then the built-in runner, if there is one, is told there's work (ci-runner.ts).
 */
async function queueHere(env: Env, owner: string, repo: string, ref: string, sha: string, by: string, why = "", edit = false) {
  const runner: Runner = env.CI_RUNNER || typeof Bun === "undefined" ? "container" : "desktop";
  const s = await checkSettings(env, owner, repo);
  if (!edit) {
    const { results } = await env.DB.prepare("SELECT * FROM check_runs WHERE owner = ? AND repo = ? AND ref = ? AND sha != ? AND runner IN ('desktop', 'container') AND status = 'queued'").bind(owner, repo, ref, sha).all();
    for (const old of results as unknown as CheckRun[]) await updateRun(env, old, { status: "cancelled", append: `\n${sha.slice(0, 12)} came along before a runner did: cancelled\n` }, by);
  }
  for (const { name, command } of await planChecks(env, owner, repo, ref, s.required, await touched(env, owner, repo, ref), s.pinned)) {
    const live = edit
      ? await env.DB.prepare("SELECT 1 FROM check_runs WHERE owner = ? AND repo = ? AND ref = ? AND name = ? AND runner IN ('desktop', 'container') AND status = 'queued'").bind(owner, repo, ref, name).first()
      : await env.DB.prepare("SELECT 1 FROM check_runs WHERE owner = ? AND repo = ? AND ref = ? AND sha = ? AND name = ? AND runner != 'github' AND status IN ('queued', 'running')").bind(owner, repo, ref, sha, name).first();
    if (live) continue;
    const run = await recordRun(env, { owner, repo, ref, sha, name, runner, command }, by);
    if (why) await env.DB.prepare("UPDATE check_runs SET log = ? WHERE id = ?").bind(why, run.id).run();
  }
  await (await import("./ci-runner.ts")).kick(env, owner, repo).catch(() => null);
}

/** Whether open branch `name` waits for another open one to merge first: the merge plan's `after` (branches.ts). */
export async function waiting(env: Env, owner: string, repo: string, name: string) {
  const row = await env.DB.prepare("SELECT waits_on FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, name).first() as { waits_on: string | null } | null;
  const on = JSON.parse(row?.waits_on ?? "[]") as string[];
  if (!on.length) return false;
  return !!await env.DB.prepare(`SELECT 1 FROM branches WHERE owner = ? AND repo = ? AND status = 'open' AND name IN (${on.map(() => "?").join(", ")})`).bind(owner, repo, ...on).first();
}

/**
 * A branch's copy of a file took an edit at `at` (file-do.ts): the branch has changed since its
 * checks, and when they run here, a run of each is queued unless one's waiting already, or the branch waits
 * for another to merge first.
 */
export async function branchEdited(env: Env, owner: string, repo: string, branch: string, at: number, by: string) {
  const r = await env.DB.prepare("UPDATE branches SET changed_at = MAX(COALESCE(changed_at, 0), ?) WHERE owner = ? AND repo = ? AND name = ? AND status = 'open'").bind(at, owner, repo, branch).run();
  if (!r.meta?.changes) return;
  try {
    // One the merge plan says waits for another to merge first runs once, after it's taken main in (#1162).
    if (await waiting(env, owner, repo, branch)) return;
    if ((await checkSettings(env, owner, repo)).here) await queueHere(env, owner, repo, branch, `${branch}@${at}`, by, "", true);
  } catch {
    // Checks never get in the way of an edit.
  }
}

/** Runs of ours still queued after UNCLAIMED are cancelled: nobody's coming for them (the hourly cron). */
export async function expireQueued(env: Env, now = Date.now()) {
  const { results } = await env.DB.prepare("SELECT * FROM check_runs WHERE status = 'queued' AND runner IN ('desktop', 'container') AND created_at < ?").bind(now - UNCLAIMED).all();
  for (const run of results as unknown as CheckRun[])
    await updateRun(env, run, { status: "cancelled", append: `\nno runner picked it up in ${UNCLAIMED / 3600_000} hours: cancelled. Start a runner (scripts/runner.ts) and press Run.\n` }, "codesplitters");
  return results.length;
}

/** Claimed runs nobody's heard from in STALE go back in the queue, for another runner (one repo's, or every repo's for the cron). */
export async function requeueStale(env: Env, now = Date.now(), only?: { owner: string; repo: string }) {
  const { results } = await env.DB.prepare(`UPDATE check_runs SET status = 'queued', started_at = NULL, heartbeat_at = NULL, runner_label = NULL, claimed_by = NULL,
      log = substr(log || char(10) || 'no word from ' || runner_label || ' in ${STALE / 60_000} minutes: back in the queue' || char(10), -${MAX_LOG})
    WHERE status = 'running' AND runner IN ('desktop', 'container') AND runner_label IS NOT NULL AND heartbeat_at < ?${only ? " AND owner = ? AND repo = ?" : ""} RETURNING *`)
    .bind(now - STALE, ...(only ? [only.owner, only.repo] : [])).all();
  for (const run of results as unknown as CheckRun[]) await postStatus(env, run).catch(() => null);
  return results.length;
}

/** A remote that clones the repo with real text, good for an hour: the crew's when there is one. */
async function cloneUrl(env: Env, owner: string, repo: string) {
  const { access, handleFor } = await import("./archive.ts");
  const h = await handleFor(env, owner, repo, true).catch(() => null);
  const art = h && await access(h.handle, h.remote, "read", 3600).catch(() => null);
  return art ? art.remote.replace("://", `://x:${art.token.split("?")[0]}@`) : null;
}

/**
 * A runner takes the oldest queued run of ours, desktop or container (never GitHub's or an
 * external CI's), of `names` when it only runs some, as `label`. One UPDATE marks it
 * running, so of two runners racing for it only one gets it. null when there's nothing to do.
 */
export async function claimRun(env: Env, owner: string, repo: string, label: string, names: string[] = [], now = Date.now(), by: string | null = null) {
  await requeueStale(env, now, { owner, repo });
  const only = names.length ? ` AND name IN (${names.map(() => "?").join(", ")})` : "";
  const run = await env.DB.prepare(`UPDATE check_runs SET status = 'running', started_at = ?, runner_label = ?, heartbeat_at = ?, claimed_by = ?
    WHERE id = (SELECT id FROM check_runs WHERE owner = ? AND repo = ? AND status = 'queued' AND runner IN ('desktop', 'container')${only} ORDER BY id LIMIT 1) AND status = 'queued' RETURNING *`)
    .bind(now, label, now, by, owner, repo, ...names).first() as CheckRun | null;
  if (!run) return null;
  const s = await checkSettings(env, owner, repo);
  const command = s.required.find((r) => r.name === run.name)?.command ?? (s.pinned ? undefined : run.command);
  // Pinned, a run with no command in the settings (queued before, or by hand) doesn't fall back to the runner's default.
  if (s.pinned && !command) {
    await updateRun(env, run, { status: "cancelled", append: "\nchecks are pinned to the settings, and this one has no command there: cancelled\n" }, "codesplitters");
    return claimRun(env, owner, repo, label, names, now, by);
  }
  await postStatus(env, run).catch(() => null);
  return { id: run.id, ref: run.ref, sha: run.sha, name: run.name, clone_url: await cloneUrl(env, owner, repo), ...(command && { command }), stale_after_s: STALE / 1000 };
}

/** A sha that went up to GitHub: poll it for its Actions results for a while. */
export async function watchGithub(env: Env, owner: string, repo: string, ref: string, sha: string) {
  if (!/^[0-9a-f]{40}$/.test(sha)) return;
  await env.DB.prepare("INSERT INTO check_watches (owner, repo, ref, sha, until) VALUES (?, ?, ?, ?, ?) ON CONFLICT (owner, repo, sha) DO UPDATE SET ref = excluded.ref, until = excluded.until")
    .bind(owner, repo, ref, sha, Date.now() + WATCH).run();
}

/** GitHub's check-run and commit-status states, as ours. */
export const fromCheckRun = (c: { status: string; conclusion: string | null }): Status =>
  c.status !== "completed" ? (c.status === "in_progress" ? "running" : "queued")
  : c.conclusion === "cancelled" ? "cancelled"
  : ["success", "neutral", "skipped"].includes(c.conclusion ?? "") ? "passed" : "failed";
export const fromState = (s: string): Status => s === "success" ? "passed" : s === "pending" ? "running" : "failed";

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
      .filter((s) => !String(s.context).startsWith(CONTEXT))
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
 * One scoped to paths the branch doesn't touch isn't required here: it's `skipped`.
 * While GitHub is down, a required check only GitHub runs is deferred, not waited
 * on, once our own checks on the sha have all passed: work carries on, and GitHub's
 * verdict comes in on main when it's back. A branch edited since its runs is `stale`:
 * every required check waits again, whatever its last run said.
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
  const changed = ref === "main" ? null : (await env.DB.prepare("SELECT changed_at FROM branches WHERE owner = ? AND repo = ? AND name = ? AND status = 'open'").bind(owner, repo, ref).first())?.changed_at as number | null ?? null;
  const asOf = sha && changed ? await checkedAt(env, owner, repo, sha, runs) : null;
  const stale = asOf !== null && changed! > asOf;
  const applies = requiredFor(s.required, await touched(env, owner, repo, ref)).map((r) => r.name);
  const skipped = s.required.map((r) => r.name).filter((n) => !applies.includes(n));
  const wanted = applies.includes("*") ? (runs.length ? runs.map((r) => r.name) : ["*"]) : applies;
  const passed: string[] = [], waiting: string[] = [], failed: string[] = [], deferred: string[] = [];
  const ours = runs.filter((r) => r.runner !== "github"), oursPassed = ours.length > 0 && ours.every((r) => r.status === "passed");
  for (const name of new Set(wanted)) {
    const r = latest.get(name);
    if (stale) waiting.push(name);
    else if (r?.status === "passed") passed.push(name);
    else if (r && DONE.has(r.status)) failed.push(name);
    else if (s.offline && oursPassed && (!r || r.runner === "github")) deferred.push(name);
    else waiting.push(name);
  }
  return {
    ref, sha, where: s.where, here: s.here, offline: s.offline, runs, stale, changed_at: changed,
    gate: { required: applies, ok: !waiting.length && !failed.length, passed, waiting, failed, deferred, skipped },
  };
}

/**
 * When a sha's runs saw the code: a git commit's when its first run was recorded or it went
 * up to GitHub, whichever came first; a branch checked as it is here (`<branch>@<time>`) when
 * its first run was claimed, since that's when the runner read it. null: none has started yet.
 */
async function checkedAt(env: Env, owner: string, repo: string, sha: string, runs: Omit<CheckRun, "log" | "junit">[]) {
  if (!/^[0-9a-f]{40}$/.test(sha) && /@\d+$/.test(sha)) {
    const started = runs.map((r) => r.started_at).filter((t): t is number => t !== null);
    return started.length ? Math.min(...started) : null;
  }
  const w = await env.DB.prepare("SELECT until FROM check_watches WHERE owner = ? AND repo = ? AND sha = ?").bind(owner, repo, sha).first();
  return Math.min(...runs.map((r) => r.created_at), ...(w ? [(w.until as number) - WATCH] : []));
}

/** Why a merge of `ref` has to wait for its checks, or null when it doesn't. */
export async function mergeBlock(env: Env, owner: string, repo: string, ref: string) {
  const c = await refChecks(env, owner, repo, ref);
  if (c.gate.ok) return null;
  const why = [c.stale && "the branch changed since its checks ran", c.gate.failed.length && `${c.gate.failed.join(", ")} failed`, c.gate.waiting.length && `waiting on ${c.gate.waiting.join(", ")}`].filter(Boolean).join("; ");
  const tip = c.offline && c.gate.waiting.length ? ". GitHub is down: run checks here, and once they pass, GitHub's wait until it's back" : "";
  const heal = c.gate.failed.length && ref !== "main" ? await (await import("./heal.ts")).heals(env, owner, repo, ref).catch(() => null) : null;
  const fixing = heal?.running ? ". A fix task is on it" : heal?.gave_up ? `. Self-healing gave up after ${heal.attempts.length} fix tasks: it waits for a person` : "";
  return { error: `required checks haven't passed: ${why}${tip}${fixing}`, checks: c.gate, ...(heal?.attempts.length && { heal }) };
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
  const body = <K extends string = never>() => readBody<K>(req);
  const crew = () => a.write ? null : json({ error: "no write access" }, 403);

  if (!p[5] && req.method === "GET") {
    const ref = url.searchParams.get("ref") || "main";
    // A branch's fix tasks so far (heal.ts), with whether it waits for a person now.
    const heal = ref === "main" ? null : await (await import("./heal.ts")).heals(env, owner, repo, ref);
    return json({ ...(await refChecks(env, owner, repo, ref)), ...(heal && { heal }) });
  }
  if (!p[5] && req.method === "POST") {
    const no = crew(); if (no) return no;
    const b = await body<"ref" | "sha" | "name" | "runner" | "status" | "url">();
    if (typeof b.ref !== "string" || typeof b.sha !== "string" || typeof b.name !== "string" || !b.ref || !b.sha || !b.name || b.name.length > 100) return json({ error: "ref, sha and name, please" }, 400);
    // find() hands back the list's own value, typed, or undefined when the client's isn't on it.
    const runner = RUNNERS.find((r) => r === b.runner), status = STATUSES.find((s) => s === b.status);
    if (b.runner && !runner) return json({ error: `runner: one of ${RUNNERS.join(", ")}` }, 400);
    if (b.status && !status) return json({ error: `status: one of ${STATUSES.join(", ")}` }, 400);
    if (b.url !== undefined && b.url !== null && typeof b.url !== "string") return json({ error: "url: text" }, 400);
    if (status && status !== "queued" && user !== owner) return json({ error: "only a runner says how a check went: record it queued for one to claim, or report through a CI token" }, 403);
    const run = await recordRun(env, { owner, repo, ref: b.ref, sha: b.sha, name: b.name, runner: runner ?? "desktop", status, url: b.url ?? undefined, runner_label: `by hand: @${user}` }, user!);
    await env.DB.prepare("UPDATE check_runs SET log = ? WHERE id = ?").bind(`recorded by hand by @${user}\n`, run.id).run();
    return json(await get(env, run.id), 201);
  }
  if (p[5] === "run" && req.method === "POST") {
    const no = crew(); if (no) return no;
    const { ref = "main" } = await body<"ref">();
    if (typeof ref !== "string") return json({ error: "ref: a branch name" }, 400);
    // Running here is always on offer, whatever the setting: local first, GitHub as the backup.
    if (ref !== "main" && !(await env.DB.prepare("SELECT 1 FROM branches WHERE owner = ? AND repo = ? AND name = ? AND status = 'open'").bind(owner, repo, ref).first())) return json({ error: "no open branch " + ref }, 404);
    const sha = await headOf(env, owner, repo, ref);
    if (!sha) return json({ error: "main has no commit yet" }, 409);
    await queueHere(env, owner, repo, ref, sha, user!);
    return json(await refChecks(env, owner, repo, ref), 202);
  }
  if (p[5] === "github" && req.method === "POST") {
    const no = crew(); if (no) return no;
    const { ref } = await body<"ref">();
    if (ref !== undefined && typeof ref !== "string") return json({ error: "ref: a branch name" }, 400);
    const { results } = await env.DB.prepare(`SELECT ref, sha FROM check_watches WHERE owner = ? AND repo = ?${ref ? " AND ref = ?" : ""}`).bind(...[owner, repo, ...(ref ? [ref] : [])]).all();
    const out = [];
    for (const w of results as { ref: string; sha: string }[]) out.push(await importGithub(env, owner, repo, w.ref, w.sha));
    return json({ polled: out });
  }
  if (p[5] === "claim" && req.method === "POST") {
    const no = crew(); if (no) return no;
    const b = await body<"runner_label" | "names">();
    if (typeof b.runner_label !== "string" || !b.runner_label.trim() || b.runner_label.length > 100) return json({ error: "runner_label, please: what this runner calls itself" }, 400);
    if (b.names !== undefined && (!Array.isArray(b.names) || b.names.some((n) => typeof n !== "string"))) return json({ error: "names: a list of check names" }, 400);
    const got = await claimRun(env, owner, repo, b.runner_label.trim(), b.names, Date.now(), user);
    return got ? json(got) : new Response(null, { status: 204 });
  }
  if (p[5] === "settings" && req.method === "GET") return json(await checkSettings(env, owner, repo));
  if (p[5] === "settings" && req.method === "PUT") {
    if (user !== owner) return json({ error: "owner only" }, 403);
    const b = await body<"where" | "required" | "post_statuses" | "pinned">();
    if (b.pinned !== undefined && typeof b.pinned !== "boolean") return json({ error: "pinned: true or false" }, 400);
    const where = (["here", "github", "both"] as const).find((w) => w === b.where);
    if (b.where != null && !where) return json({ error: "where: here, github or both" }, 400);
    const required: Required[] | null | undefined = b.required === undefined ? undefined : Array.isArray(b.required) ? b.required.map((r) => typeof r === "string" ? { name: r } : r) : null;
    const bad = (r: Required) => !r || typeof r.name !== "string" || !r.name.trim() || r.name.includes(",")
      || (r.paths !== undefined && (!Array.isArray(r.paths) || r.paths.some((x) => typeof x !== "string" || !x.trim())))
      || (r.command !== undefined && (typeof r.command !== "string" || r.command.length > 1000));
    if (required === null || required?.some(bad)) return json({ error: "required: a list of check names or {name, paths?, command?}, or [\"*\"] for all" }, 400);
    const now = await checkSettings(env, owner, repo);
    const had = await env.DB.prepare("SELECT run_where FROM check_settings WHERE owner = ? AND repo = ?").bind(owner, repo).first();
    await env.DB.prepare("INSERT INTO check_settings (owner, repo, run_where, required, post_statuses, pinned) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (owner, repo) DO UPDATE SET run_where = excluded.run_where, required = excluded.required, post_statuses = excluded.post_statuses, pinned = excluded.pinned")
      .bind(owner, repo, b.where !== undefined ? (where ?? null) : (had?.run_where ?? null), JSON.stringify((required ?? now.required).map((r) => ({
        name: r.name.trim(), ...(r.paths?.length && { paths: r.paths.map((x) => x.trim()) }), ...(r.command && { command: r.command }),
      }))), (b.post_statuses ?? now.post_statuses) ? 1 : 0, (b.pinned ?? now.pinned) ? 1 : 0).run();
    return json(await checkSettings(env, owner, repo));
  }

  const id = Number(p[5]);
  const run = Number.isInteger(id) && id > 0 ? await get(env, id) : null;
  if (!run || run.owner !== owner || run.repo !== repo) return json({ error: "no such check run" }, 404);
  if (!p[6] && req.method === "GET") return json(run);
  if (!p[6] && req.method === "PUT") {
    const no = crew(); if (no) return no;
    const b = await body<"status" | "log" | "append" | "junit" | "runner_label" | "url">();
    const status = STATUSES.find((s) => s === b.status);
    if (b.status && !status) return json({ error: `status: one of ${STATUSES.join(", ")}` }, 400);
    const text = (v: unknown) => typeof v === "string" ? v : undefined;
    if ([b.log, b.append, b.junit, b.runner_label, b.url].some((v) => v !== undefined && text(v) === undefined)) return json({ error: "log, append, junit, runner_label and url: text" }, 400);
    if (run.runner === "github") return json({ error: "GitHub's runs come from GitHub" }, 409);
    if (b.status && b.status !== run.status && user !== owner && run.claimed_by !== user) return json({ error: "only the runner that claimed it says how it went: POST .../checks/claim first" }, 403);
    // A runner that went quiet and lost its claim stops: the run is someone else's now.
    if (b.runner_label && b.runner_label !== run.runner_label && !DONE.has(run.status)) return json({ error: run.runner_label ? `${run.runner_label} has it now` : "it went back in the queue: no word from you in time" }, 409);
    const after = await updateRun(env, run, { status, log: text(b.log), append: text(b.append), junit: text(b.junit), url: text(b.url) }, user!);
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
