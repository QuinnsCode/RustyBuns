// External CI reports here the way it reports to GitHub (#533). Most CI tools post
// their results through GitHub's API at a base URL you can set (the "GitHub
// Enterprise" option): point that at /api/gh/v3 on this site, hand it a repo's CI
// token as its GitHub token, and its statuses and check runs land in our checks as
// `external` runs, gating merges like any other. Only what status reporters call
// is here, not the rest of GitHub's API.
//
// A commit status is one run per context: posting the same context again moves
// that run on, or starts a new one once it has finished (a re-run). GitHub's states
// map to ours: pending is running, success passed, failure and error failed. A
// sha's ref is the one its runs or its push upstream were on, else main.
//
// A CI token reaches one repo's checks and nothing else. The owner makes and
// revokes them; only the SHA-256 is kept, and the secret is shown once. Each
// expires, 90 days out unless it was made with days (1 to 365), and is then a 401. It's sent
// as `Authorization: token …` or `Bearer …`, as tools send a GitHub PAT. Each
// token's calls count against the `ci` rate limit (limits.ts), and its label is
// the runner_label of the runs it reports, so the checks pill names the CI.
//
//   GET    /api/repos/:o/:r/checks/tokens       the repo's CI tokens, without their secrets (owner only)
//   POST   /api/repos/:o/:r/checks/tokens {label, days?}  make one: the secret is shown this once (owner only)
//   DELETE /api/repos/:o/:r/checks/tokens/:id   revoke it (owner only)
//
//   POST   /api/gh/v3/repos/:o/:r/statuses/:sha      {state, context?, target_url?, description?}
//   GET    /api/gh/v3/repos/:o/:r/commits/:sha/status       the combined status, as GitHub answers it
//   POST   /api/gh/v3/repos/:o/:r/check-runs         {name, head_sha, status?, conclusion?, details_url?, output?}
//   PATCH  /api/gh/v3/repos/:o/:r/check-runs/:id     {status?, conclusion?, details_url?, output?}
//   GET    /api/gh/v3/repos/:o/:r/commits/:sha/check-runs   {total_count, check_runs}

import { DONE, fromCheckRun, fromState, get, recordRun, shaped, updateRun, type CheckRun, type Status } from "./checks.ts";
import { audit } from "./audit.ts";
import { json, type Env, readBody } from "./env.ts";
import { limit } from "./limits.ts";
import { DAY, MAX_DAYS } from "./tokens.ts";
import { b64url, sha256 } from "./util.ts";

const MAX_TOKENS = 20;
export const CI_TOKEN_DAYS = 90;
const DOCS = "https://docs.github.com/rest";
/** GitHub's errors are {message, documentation_url}; clients read message. */
const fail = (message: string, status: number, headers?: Record<string, string>) => json({ message, documentation_url: DOCS }, status, headers);

/** /api/repos/:o/:r/checks/tokens: the owner's to make and revoke. */
export async function ciTokenRoutes(req: Request, env: Env, p: string[], owner: string, repo: string, user: string | null): Promise<Response | null> {
  if (p[4] !== "checks" || p[5] !== "tokens") return null;
  if (user !== owner) return json({ error: "owner only" }, 403);
  if (!p[6] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, label, last4, created_by, created_at, expires_at, last_used_at FROM ci_tokens WHERE owner = ? AND repo = ? ORDER BY created_at DESC").bind(owner, repo).all();
    return json(results.map((t: any) => ({ ...t, expired: t.expires_at <= Date.now() })));
  }
  if (!p[6] && req.method === "POST") {
    const b = await readBody<"label" | "days">(req);
    const label = typeof b.label === "string" ? b.label.trim().slice(0, 60) : "";
    if (!label) return json({ error: "label: which CI it's for, like jenkins" }, 400);
    const days = b.days ?? CI_TOKEN_DAYS;
    if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) return json({ error: `days: 1 to ${MAX_DAYS}` }, 400);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM ci_tokens WHERE owner = ? AND repo = ?").bind(owner, repo).first();
    if ((n?.n as number ?? 0) >= MAX_TOKENS) return json({ error: `at most ${MAX_TOKENS} CI tokens a repo: revoke one first` }, 400);
    const secret = "csci_" + b64url(crypto.getRandomValues(new Uint8Array(32)));
    const now = Date.now();
    const t = { id: crypto.randomUUID().slice(0, 8), label, last4: secret.slice(-4), created_by: user, created_at: now, expires_at: now + days * DAY };
    await env.DB.prepare("INSERT INTO ci_tokens (id, owner, repo, label, hash, last4, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(t.id, owner, repo, t.label, await sha256(secret), t.last4, t.created_by, t.created_at, t.expires_at).run();
    await audit(env, req, { actor: user, action: "ci_token.create", owner, repo, target: t.id, detail: label });
    return json({ ...t, token: secret }, 201);
  }
  if (p[6] && !p[7] && req.method === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM ci_tokens WHERE id = ? AND owner = ? AND repo = ?").bind(p[6], owner, repo).run();
    if (!r.meta?.changes) return json({ error: "no such token" }, 404);
    await audit(env, req, { actor: user, action: "ci_token.revoke", owner, repo, target: p[6] });
    return json({ ok: true });
  }
  return null;
}

/** The repo's live CI token a request carries, as `token …` or `Bearer …`, or null (an expired one too). */
async function ciToken(req: Request, env: Env, owner: string, repo: string) {
  const secret = /^(?:token|bearer)\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!secret) return null;
  const t = await env.DB.prepare("SELECT id, label, last_used_at FROM ci_tokens WHERE hash = ? AND owner = ? AND repo = ? AND expires_at > ?").bind(await sha256(secret), owner, repo, Date.now()).first() as { id: string; label: string; last_used_at: number | null } | null;
  // Last used, to the minute.
  if (t && (!t.last_used_at || Date.now() - t.last_used_at > 60_000)) await env.DB.prepare("UPDATE ci_tokens SET last_used_at = ? WHERE id = ?").bind(Date.now(), t.id).run();
  return t;
}

/** The ref a sha belongs to: the one its runs are on, or it went upstream from, else main. */
async function refOf(env: Env, owner: string, repo: string, sha: string) {
  const run = await env.DB.prepare("SELECT ref FROM check_runs WHERE owner = ? AND repo = ? AND sha = ? ORDER BY id DESC LIMIT 1").bind(owner, repo, sha).first();
  const watch = run ? null : await env.DB.prepare("SELECT ref FROM check_watches WHERE owner = ? AND repo = ? AND sha = ?").bind(owner, repo, sha).first();
  return (run?.ref ?? watch?.ref ?? "main") as string;
}

const iso = (t: number | null) => t ? new Date(t).toISOString() : null;
const ms = (s: unknown) => typeof s === "string" && !Number.isNaN(Date.parse(s)) ? Date.parse(s) : null;

/** A run that came in as a commit status, shaped like GitHub's status object. */
const asStatus = (r: CheckRun, base: string) => ({
  id: r.id, url: `${base}/statuses/${r.sha}`, context: r.name,
  state: r.status === "passed" ? "success" : r.status === "failed" || r.status === "cancelled" ? "failure" : "pending",
  description: r.log.split("\n").find(Boolean) ?? null, target_url: r.url,
  created_at: iso(r.created_at), updated_at: iso(r.finished_at ?? r.started_at ?? r.created_at),
});

/** GitHub's check-run status and conclusion as ours (none when it gave neither), or what's wrong with them. */
function checkStatus(b: { status?: unknown; conclusion?: unknown }): { status?: Status } | { error: string } {
  if (typeof b.conclusion === "string" && b.conclusion) return { status: fromCheckRun({ status: "completed", conclusion: b.conclusion }) };
  if (b.conclusion) return { error: "conclusion: a GitHub check-run conclusion" };
  if (b.status === undefined) return {};
  if (b.status === "completed") return { error: "conclusion: required when status is completed" };
  const status = (["queued", "in_progress"] as const).find((s) => s === b.status);
  return status ? { status: fromCheckRun({ status, conclusion: null }) } : { error: "status: queued, in_progress or completed" };
}

/** A check run's output, as its log: title, summary and text. */
const outputLog = (o: unknown) => {
  const x = (o ?? {}) as { title?: unknown; summary?: unknown; text?: unknown };
  return [x.title, x.summary, x.text].filter((s) => typeof s === "string" && s).join("\n\n") || undefined;
};

/** /api/gh/v3/repos/:o/:r/…: GitHub's status and check-run writes (and their reads), for external CI. */
export async function ghCompatRoutes(req: Request, env: Env, p: string[], url: URL): Promise<Response | null> {
  if (p[1] !== "gh" || p[2] !== "v3") return null;
  if (p[3] !== "repos" || !p[4] || !p[5]) return fail("Not Found", 404);
  const [owner, repo] = [p[4], p[5]], rest = p.slice(6);
  const t = await ciToken(req, env, owner, repo);
  // A token for another repo, or none, can't tell this one exists.
  if (!t) return req.headers.get("authorization") ? fail("Bad credentials", 401) : fail("Not Found", 404);
  // Each token counts on its own, so a leaked one can only flood so far before it's revoked.
  const slow = await limit(req, env, "ci", `${owner}/${repo}#${t.id}`, false);
  if (slow) return fail((await slow.json() as { error: string }).error, 429, { "retry-after": slow.headers.get("retry-after") ?? "60" });
  const by = `ci:${t.label}`, base = `${url.origin}/api/gh/v3/repos/${owner}/${repo}`;
  const body = () => readBody<"state" | "context" | "target_url" | "description" | "name" | "head_sha" | "status" | "conclusion" | "details_url" | "external_id" | "started_at" | "completed_at" | "output">(req);

  // POST statuses/:sha: one run per context, moved on or (once finished) started again.
  if (rest[0] === "statuses" && rest[1] && !rest[2] && req.method === "POST") {
    const b = await body(), sha = rest[1];
    const state = (["pending", "success", "failure", "error"] as const).find((x) => x === b.state);
    if (!state) return fail("state: pending, success, failure or error", 422);
    const context = String(b.context ?? "default").slice(0, 100), status = fromState(state);
    const target = typeof b.target_url === "string" ? b.target_url : null, about = typeof b.description === "string" ? b.description.slice(0, 140) : "";
    const had = await env.DB.prepare("SELECT * FROM check_runs WHERE owner = ? AND repo = ? AND sha = ? AND external_id = ? AND runner = 'external' ORDER BY id DESC LIMIT 1")
      .bind(owner, repo, sha, `status:${context}`).first() as CheckRun | null;
    const run = had && !DONE.has(had.status)
      ? await updateRun(env, had, { status, url: target, log: about }, by)
      : await recordRun(env, { owner, repo, ref: await refOf(env, owner, repo, sha), sha, name: context, runner: "external", runner_label: t.label, status, url: target, external_id: `status:${context}` }, by)
        .then((r) => about ? updateRun(env, r, { log: about }, by) : r);
    return json(asStatus(run!, base), 201);
  }

  // POST check-runs: a new run.
  if (rest[0] === "check-runs" && !rest[1] && req.method === "POST") {
    const b = await body();
    if (typeof b.name !== "string" || !b.name || b.name.length > 100 || typeof b.head_sha !== "string" || !b.head_sha) return fail("name and head_sha, please", 422);
    const s = checkStatus(b);
    if ("error" in s) return fail(s.error, 422);
    const sha = b.head_sha;
    let run = await recordRun(env, {
      owner, repo, ref: await refOf(env, owner, repo, sha), sha, name: b.name, runner: "external", runner_label: t.label, status: s.status,
      url: typeof b.details_url === "string" ? b.details_url : null, external_id: typeof b.external_id === "string" ? `check:${b.external_id}` : null,
      started_at: ms(b.started_at), finished_at: ms(b.completed_at),
    }, by);
    const log = outputLog(b.output);
    if (log) run = (await updateRun(env, run, { log }, by))!;
    return json(shaped(run), 201);
  }

  // PATCH check-runs/:id: move it on. A finished run stays finished.
  if (rest[0] === "check-runs" && rest[1] && !rest[2] && req.method === "PATCH") {
    const id = Number(rest[1]);
    const run = Number.isInteger(id) && id > 0 ? await get(env, id) : null;
    if (!run || run.owner !== owner || run.repo !== repo || run.runner !== "external") return fail("Not Found", 404);
    const b = await body();
    const s = checkStatus(b);
    if ("error" in s) return fail(s.error, 422);
    const after = await updateRun(env, run, { status: s.status, url: typeof b.details_url === "string" ? b.details_url : null, log: outputLog(b.output) }, by);
    return after ? json(shaped(after)) : fail(`it's ${run.status} already`, 422);
  }

  // GET commits/:sha/status and commits/:sha/check-runs: what they wrote, read back.
  if (rest[0] === "commits" && rest[1] && !rest[3] && req.method === "GET" && (rest[2] === "status" || rest[2] === "check-runs")) {
    const { results } = await env.DB.prepare("SELECT * FROM check_runs WHERE owner = ? AND repo = ? AND sha = ? ORDER BY id").bind(owner, repo, rest[1]).all();
    const latest = new Map<string, CheckRun>();
    for (const r of results as CheckRun[]) latest.set(r.name, r);
    const runs = [...latest.values()];
    if (rest[2] === "check-runs") {
      const checks = runs.filter((r) => !r.external_id?.startsWith("status:"));
      return json({ total_count: checks.length, check_runs: checks.map(shaped) });
    }
    const statuses = runs.filter((r) => r.external_id?.startsWith("status:")).map((r) => asStatus(r, base));
    const state = statuses.some((s) => s.state === "failure") ? "failure" : statuses.length && statuses.every((s) => s.state === "success") ? "success" : "pending";
    return json({ state, sha: rest[1], total_count: statuses.length, statuses, repository: { full_name: `${owner}/${repo}` } });
  }
  return fail("Not Found", 404);
}
