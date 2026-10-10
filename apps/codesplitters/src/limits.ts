// Rate limits on what costs money or invites abuse: signing in and up, digging
// up repos (Artifacts imports), the GitHub calls the site's token pays for,
// commits (Artifacts pushes), live line edits, and the things a spammer would
// make by the thousand. Each rule counts per caller (their handle, else their IP) in fixed
// windows, in D1. Admins tune them on the rate limits page (#/admin/limits,
// GET|PUT /api/admin/limits): each rule's cap and window, and what happens to a
// caller over it: reject (a 429), log (let it through, note it), flag (let it
// through, and list the caller at the top of the page), or, for slow and costly
// jobs only, queue (hold it, and run it once the caller's window has room). The
// first time a caller goes over in a window is logged either way, and an admin
// can reset a caller.
//
// A queued request answers 202 with its place in line. It waits in limit_jobs
// and is replayed as the caller, not counted again but taking one of their
// window's slots, when the page polls GET /api/jobs/:id (or the caller's list,
// GET /api/jobs, which their profile shows) or on the five-minute cron. Only
// digs queue: line edits are pinned to the file's rev, so a queued one would
// come back a conflict, and sign-ins should stay rejected.
//
// Only requests from the internet are counted: Cloudflare stamps those with
// cf-connecting-ip. The desktop, the tests, and the Worker's own calls (hosted
// agents, the dependency doctor) carry none. Admins are never limited.
//
// Edits sent over a file's WebSocket skip the Worker, so the Worker works out
// who a socket counts as when it opens (or that it isn't counted) and the
// file's DO counts each edit with countHit.

import { json, type Env } from "./env.ts";
import { actingAs } from "./identity.ts";

export const ACTIONS = ["reject", "log", "flag", "queue"] as const;
export type Action = (typeof ACTIONS)[number];
export interface Rule { name: string; label: string; what: string; group: string; per: "ip" | "user"; max: number; window_s: number; on_fail: Action; queueable?: true }

const MIN = 60, HOUR = 3600, DAY = 86400;
export const RULES: Rule[] = [
  { name: "signin", label: "Sign in", what: "password and social sign-ins", group: "Accounts", per: "ip", max: 10, window_s: 10 * MIN, on_fail: "reject" },
  { name: "signup", label: "Create account", what: "new email accounts", group: "Accounts", per: "ip", max: 5, window_s: HOUR, on_fail: "reject" },
  { name: "mail", label: "Account email", what: "verification and password reset emails sent", group: "Accounts", per: "ip", max: 5, window_s: HOUR, on_fail: "reject" },
  { name: "handle", label: "Claim a handle", what: "picking your @handle", group: "Accounts", per: "ip", max: 10, window_s: HOUR, on_fail: "reject" },
  { name: "dig", label: "Dig up a repo", what: "GitHub digs and level forks (Artifacts imports)", group: "GitHub", per: "user", max: 5, window_s: HOUR, on_fail: "reject", queueable: true },
  { name: "github", label: "GitHub lookups", what: "repo lists and search, on the site's GitHub token", group: "GitHub", per: "user", max: 30, window_s: MIN, on_fail: "reject" },
  { name: "search", label: "Code search", what: "full-text search over committed code", group: "Repos", per: "user", max: 30, window_s: MIN, on_fail: "reject" },
  { name: "repo", label: "New repos", what: "empty repos made here", group: "Repos", per: "user", max: 10, window_s: DAY, on_fail: "reject" },
  { name: "file", label: "New files", what: "files added to a repo", group: "Repos", per: "user", max: 120, window_s: HOUR, on_fail: "reject" },
  { name: "edit", label: "Line edits", what: "live edits to a file's lines, over its socket or POST", group: "Editing and sharing", per: "user", max: 300, window_s: MIN, on_fail: "reject" },
  { name: "commit", label: "Commits", what: "pushes to Artifacts", group: "Repos", per: "user", max: 60, window_s: HOUR, on_fail: "reject" },
  { name: "share", label: "Shares and collections", what: "share links, collections and tracks", group: "Editing and sharing", per: "user", max: 60, window_s: HOUR, on_fail: "reject" },
  { name: "agent", label: "Coding agents", what: "hosted agent runs, on the site's API keys", group: "Agents", per: "user", max: 20, window_s: DAY, on_fail: "reject" },
];

/** Which rule a request counts against, if any. */
export function ruleFor(method: string, p: string[]): string | null {
  if (method === "GET") {
    if (p[1] === "github" && (p[2] === "repos" || p[2] === "search")) return "github";
    if (p[1] === "search") return "search";
    return null;
  }
  if (method !== "POST") return null;
  if (p[1] === "auth") return p[2] === "sign-in" ? "signin" : p[2] === "sign-up" ? "signup"
    : p[2] === "request-password-reset" || p[2] === "send-verification-email" ? "mail" : null;
  if (p[1] === "handle") return "handle";
  if (p[1] === "github" && p[2] === "dig") return "dig";
  if (p[1] === "levels" && p[3] === "fork") return "dig";
  if (p[1] === "playlists") return "share";
  if (p[1] === "repos" && !p[2]) return "repo";
  if (p[1] === "repos" && p[4] === "files") return "file";
  if (p[1] === "repos" && p[4] === "shares") return "share";
  if (p[1] === "repos" && p[4] === "agents") return "agent";
  if (p[1] === "repos" && p[4] === "do" && p[5] === "commit") return "commit";
  if (p[1] === "repos" && p[4] === "do" && p[5] === "ops") return "edit";
  return null;
}

// An admin's changes, read at most every 30 seconds per isolate.
let cache: { at: number; env: object; rules: Map<string, Rule & { enabled: boolean }> } | null = null;
const isAction = (a: unknown): a is Action => ACTIONS.includes(a as Action);
async function rules(env: Env) {
  if (cache && cache.env === env && Date.now() - cache.at < 30_000) return cache.rules;
  const { results } = await env.DB.prepare("SELECT name, max, window_s, enabled, on_fail FROM limit_rules").all();
  const saved = new Map((results as { name: string; max: number; window_s: number; enabled: number; on_fail: string }[]).map((r) => [r.name, r]));
  const out = new Map(RULES.map((r) => {
    const s = saved.get(r.name);
    return [r.name, { ...r, ...(s ? { max: s.max, window_s: s.window_s, on_fail: isAction(s.on_fail) ? s.on_fail : r.on_fail } : {}), enabled: s ? !!s.enabled : true }];
  }));
  cache = { at: Date.now(), env, rules: out };
  return out;
}

const ipOf = (req: Request) => req.headers.get("cf-connecting-ip");

/** Who a request counts as under a rule, or null when it isn't counted (not from the internet, an admin, or no such rule). */
export function counted(req: Request, rule: string | null, user: string | null, admin: boolean): string | null {
  const ip = ipOf(req), r = RULES.find((d) => d.name === rule);
  if (!r || !ip || admin) return null;
  return r.per === "user" && user ? `@${user}` : ip;
}

/** Count one hit against the rule for `who`; when that's over the limit and the rule rejects, why, and how many seconds to wait. */
export async function countHit(env: Env, rule: string, who: string): Promise<{ error: string; wait: number } | null> {
  const over = await hit(env, rule, who, false);
  return over && "error" in over ? over : null;
}

/** countHit, but with `queue` a queueing rule says so (and which window it was) instead of rejecting. */
async function hit(env: Env, rule: string, who: string, queue: boolean): Promise<{ error: string; wait: number } | { queue: Rule; win: number } | null> {
  const r = (await rules(env)).get(rule);
  if (!r?.enabled) return null;
  const span = r.window_s * 1000, win = Math.floor(Date.now() / span) * span;
  const row = await env.DB.prepare(
    "INSERT INTO limit_hits (rule, who, win, count) VALUES (?, ?, ?, 1) ON CONFLICT (rule, who, win) DO UPDATE SET count = count + 1 RETURNING count")
    .bind(rule, who, win).first();
  const count = row?.count as number;
  if (count <= r.max) return null;
  // The first time over in a window goes in the log, whatever the rule does about it.
  if (count === r.max + 1)
    await env.DB.prepare("INSERT INTO limit_events (rule, who, win, action, at) VALUES (?, ?, ?, ?, ?)").bind(rule, who, win, r.on_fail, Date.now()).run();
  if (r.on_fail === "queue" && r.queueable && queue) return { queue: r, win };
  if (r.on_fail !== "reject" && r.on_fail !== "queue") return null;
  const wait = Math.ceil((win + span - Date.now()) / 1000);
  return { error: `Slow down: ${r.label.toLowerCase()} is limited to ${r.max} per ${every(r.window_s)}. Try again in ${every(wait)}.`, wait };
}

/** A 429 when this caller is over the rule's limit, or a 202 when it queues them; else null (and the hit is counted). */
export async function limit(req: Request, env: Env, rule: string | null, user: string | null, admin: boolean): Promise<Response | null> {
  const who = counted(req, rule, user, admin);
  // Only a signed-in caller can be queued: the job runs as them, and only they may poll it.
  const over = who ? await hit(env, rule!, who, !!user) : null;
  if (!over) return null;
  if ("error" in over) return json({ error: over.error }, 429, { "retry-after": String(over.wait) });
  const r = over.queue, span = r.window_s * 1000;
  // The line holds one window's worth; past that, it's a 429 like any other.
  const ahead = (await env.DB.prepare("SELECT COUNT(*) AS n FROM limit_jobs WHERE rule = ? AND who = ? AND state != 'done'").bind(r.name, who).first())?.n as number;
  if (ahead >= r.max) {
    const wait = Math.ceil((over.win + span - Date.now()) / 1000);
    return json({ error: `Slow down: ${r.label.toLowerCase()} is limited to ${r.max} per ${every(r.window_s)}, and your line is full. Try again in ${every(wait)}.` }, 429, { "retry-after": String(wait) });
  }
  const url = new URL(req.url), body = req.method === "GET" ? null : await req.clone().text();
  const row = await env.DB.prepare("INSERT INTO limit_jobs (rule, who, user, method, path, body, state, at) VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?) RETURNING id")
    .bind(r.name, who, user, req.method, url.pathname + url.search, body, Date.now()).first();
  return json({ queued: await place(env, row!.id as number) }, 202);
}

type Job = { id: number; rule: string; who: string; user: string; method: string; path: string; body: string | null; state: string; at: number; status: number | null; result: string | null };

/** Where a job stands: its place in its caller's line and about when it runs, or how it came out. */
async function place(env: Env, id: number) {
  const j = await env.DB.prepare("SELECT * FROM limit_jobs WHERE id = ?").bind(id).first() as Job | null;
  if (!j) return null;
  const out = { id: j.id, rule: j.rule, state: j.state };
  if (j.state === "done") return { ...out, status: j.status, result: j.result ? JSON.parse(j.result) : null };
  if (j.state === "running") return out;
  const r = (await rules(env)).get(j.rule)!, span = r.window_s * 1000, win = Math.floor(Date.now() / span) * span;
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM limit_jobs WHERE rule = ? AND who = ? AND state = 'waiting' AND id <= ?").bind(j.rule, j.who, j.id).first())?.n as number;
  // Each window lets `max` through: the first `max` in line go when this one ends, the next when the one after does.
  return { ...out, place: n, label: r.label, eta: win + span * (1 + Math.floor((n - 1) / r.max)) };
}

/** Run what's at the front of this caller's line while their window has room, oldest first. */
async function drain(env: Env, rule: string, who: string, self: (r: Request) => Promise<Response>) {
  const r = (await rules(env)).get(rule);
  if (!r) return;
  for (;;) {
    const j = await env.DB.prepare("SELECT * FROM limit_jobs WHERE rule = ? AND who = ? AND state = 'waiting' ORDER BY id LIMIT 1").bind(rule, who).first() as Job | null;
    if (!j) return;
    // Two polls can race for the same job; whoever marks it running runs it.
    const claimed = await env.DB.prepare("UPDATE limit_jobs SET state = 'running', started = ? WHERE id = ? AND state = 'waiting'").bind(Date.now(), j.id).run();
    if (!claimed.meta?.changes) continue;
    // Then it takes one of the window's slots, if there's one left (a switched-off rule has room for everyone).
    const span = r.window_s * 1000, win = Math.floor(Date.now() / span) * span;
    const slot = await env.DB.prepare(
      "INSERT INTO limit_hits (rule, who, win, count) VALUES (?, ?, ?, 1) ON CONFLICT (rule, who, win) DO UPDATE SET count = count + 1 WHERE count < ? OR ? RETURNING count")
      .bind(rule, who, win, r.max, r.enabled ? 0 : 1).first();
    if (!slot) { await env.DB.prepare("UPDATE limit_jobs SET state = 'waiting', started = NULL WHERE id = ?").bind(j.id).run(); return; }
    const req = new Request("http://codesplitters.local" + j.path, { method: j.method, headers: j.body === null ? {} : { "content-type": "application/json" }, body: j.body });
    actingAs.set(req, j.user);
    let status = 500, result = JSON.stringify({ error: "the queued job failed" });
    try { const res = await self(req); status = res.status; result = await res.text(); } catch (e) { result = JSON.stringify({ error: String((e as Error)?.message ?? e) }); }
    await env.DB.prepare("UPDATE limit_jobs SET state = 'done', status = ?, result = ? WHERE id = ?").bind(status, result, j.id).run();
  }
}

/** The five-minute cron: run every line that has room, for callers who closed the page. */
export async function drainJobs(env: Env, self: (r: Request) => Promise<Response>) {
  const { results } = await env.DB.prepare("SELECT DISTINCT rule, who FROM limit_jobs WHERE state = 'waiting'").all();
  for (const { rule, who } of results as { rule: string; who: string }[]) await drain(env, rule, who, self);
}

/** What a queued job was for, in a few words: the GitHub repo a dig names, or the level a fork copies. */
function what(j: Pick<Job, "path" | "body">) {
  const fork = /^\/api\/levels\/([^/?]+)\/fork/.exec(j.path);
  if (fork) return `fork of ${decodeURIComponent(fork[1])}`;
  try { const b = JSON.parse(j.body ?? "{}"); if (typeof b.repo === "string") return b.repo; } catch {}
  return j.path.replace(/^\/api/, "");
}

/**
 * GET /api/jobs  the caller's own queued requests from the last week, newest first: waiting ones with their
 * place in line, and finished ones with the repo they made ({owner, name}) or the error they hit. Like polling
 * one job, it runs whatever is due first, so coming back to the page is enough to move the line along.
 * GET /api/jobs/:id  a queued request: its place in line, or, once it has run, the answer it would have had. Polling runs it when it's due.
 */
export async function jobRoutes(req: Request, env: Env, p: string[], user: string | null, admin: boolean, self: (r: Request) => Promise<Response>): Promise<Response | null> {
  if (p[1] !== "jobs" || p[3] || req.method !== "GET") return null;
  if (!p[2]) {
    if (!user) return json({ error: "sign in first" }, 401);
    const { results: lines } = await env.DB.prepare("SELECT DISTINCT rule, who FROM limit_jobs WHERE user = ? AND state = 'waiting'").bind(user).all();
    for (const { rule, who } of lines as { rule: string; who: string }[]) await drain(env, rule, who, self);
    const { results } = await env.DB.prepare("SELECT id, path, body, at FROM limit_jobs WHERE user = ? ORDER BY id DESC LIMIT 50").bind(user).all();
    const jobs = [];
    for (const j of results as Pick<Job, "id" | "path" | "body" | "at">[]) {
      const pl = await place(env, j.id);
      if (!pl) continue;
      // A finished job keeps only what the page links to, not the whole response.
      if ("result" in pl) {
        const r = (pl.result ?? {}) as { owner?: string; name?: string; error?: string; message?: string }, ok = pl.status! < 400;
        jobs.push({ ...pl, result: ok ? { owner: r.owner, name: r.name } : { error: r.error || r.message || `failed (${pl.status})` }, what: what(j), at: j.at });
      } else jobs.push({ ...pl, what: what(j), at: j.at });
    }
    return json({ jobs });
  }
  const j = await env.DB.prepare("SELECT rule, who, user FROM limit_jobs WHERE id = ?").bind(Number(p[2])).first() as Pick<Job, "rule" | "who" | "user"> | null;
  if (!j || (j.user !== user && !admin)) return json({ error: "not found" }, 404);
  await drain(env, j.rule, j.who, self);
  return json(await place(env, Number(p[2])));
}

/** "10 minutes", "hour", "2 days". */
export function every(s: number) {
  const [n, unit] = s % DAY === 0 ? [s / DAY, "day"] : s % HOUR === 0 ? [s / HOUR, "hour"] : s >= MIN ? [Math.ceil(s / MIN), "minute"] : [s, "second"];
  return n === 1 ? unit : `${n} ${unit}s`;
}

/** The hourly cron: drop windows that have ended, log entries and finished jobs older than a week, and give up on jobs stuck running. */
export async function sweepLimits(env: Env, now = Date.now()) {
  const longest = Math.max(...[...(await rules(env)).values()].map((r) => r.window_s)) * 1000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM limit_hits WHERE win < ?").bind(now - longest),
    env.DB.prepare("DELETE FROM limit_events WHERE at < ?").bind(now - 7 * DAY * 1000),
    env.DB.prepare("DELETE FROM limit_jobs WHERE state = 'done' AND at < ?").bind(now - 7 * DAY * 1000),
    env.DB.prepare("UPDATE limit_jobs SET state = 'done', status = 504, result = ? WHERE state = 'running' AND started < ?").bind(JSON.stringify({ error: "the queued job never finished" }), now - 15 * MIN * 1000),
  ]);
}

/**
 * GET  /api/admin/limits  every rule with this window's traffic (callers, hits, and how many are over),
 *                          the last week's log of callers going over, and who's flagged.
 * PUT  /api/admin/limits {rules: [{name, max, window_s, enabled, on_fail?}]}
 * POST /api/admin/limits/reset {who, rule?}  clear a caller's counts (one rule's, or all) and their log entries.
 */
export async function limitRoutes(req: Request, env: Env, p: string[], admin: boolean): Promise<Response | null> {
  if (p[1] !== "admin" || p[2] !== "limits") return null;
  if (!admin) return json({ error: "admins only" }, 403);
  if (p[3] === "reset" && req.method === "POST") {
    const b = (await req.json().catch(() => ({}))) as { who?: string; rule?: string };
    if (!b.who) return json({ error: "who required" }, 400);
    const only = b.rule ? " AND rule = ?" : "", args = b.rule ? [b.who, b.rule] : [b.who];
    await env.DB.batch([
      env.DB.prepare("DELETE FROM limit_hits WHERE who = ?" + only).bind(...args),
      env.DB.prepare("DELETE FROM limit_events WHERE who = ?" + only).bind(...args),
    ]);
    return json({ ok: true });
  }
  if (p[3]) return null;
  if (req.method === "PUT") {
    const b = (await req.json().catch(() => ({}))) as { rules?: { name: string; max: number; window_s: number; enabled: boolean; on_fail?: string }[] };
    for (const r of b.rules ?? []) {
      if (!RULES.some((d) => d.name === r.name)) return json({ error: `no rule ${r.name}` }, 400);
      if (!(Number.isInteger(r.max) && r.max >= 1 && r.max <= 100_000)) return json({ error: `${r.name}: max is a whole number, 1 to 100000` }, 400);
      if (!(Number.isInteger(r.window_s) && r.window_s >= 1 && r.window_s <= 30 * DAY)) return json({ error: `${r.name}: the window is 1 second to 30 days` }, 400);
      if (r.on_fail !== undefined && !isAction(r.on_fail)) return json({ error: `${r.name}: on_fail is ${ACTIONS.join(", ")}` }, 400);
      if (r.on_fail === "queue" && !RULES.find((d) => d.name === r.name)!.queueable) return json({ error: `${r.name}: only slow, costly jobs can queue` }, 400);
    }
    const current = await rules(env);
    await env.DB.batch((b.rules ?? []).map((r) => env.DB.prepare("INSERT OR REPLACE INTO limit_rules (name, max, window_s, enabled, on_fail) VALUES (?, ?, ?, ?, ?)")
      .bind(r.name, r.max, r.window_s, r.enabled ? 1 : 0, r.on_fail ?? current.get(r.name)!.on_fail)));
    cache = null;
  } else if (req.method !== "GET") return null;
  const now = Date.now();
  const out = [];
  for (const r of (await rules(env)).values()) {
    const span = r.window_s * 1000, win = Math.floor(now / span) * span;
    const s = await env.DB.prepare("SELECT COUNT(*) AS callers, COALESCE(SUM(count), 0) AS hits, COALESCE(SUM(count > ?), 0) AS blocked FROM limit_hits WHERE rule = ? AND win = ?")
      .bind(r.max, r.name, win).first();
    const { name, label, what, group, per, max, window_s, enabled, on_fail, queueable = false } = r;
    out.push({ name, label, what, group, per, max, window_s, enabled, on_fail, queueable, defaults: RULES.find((d) => d.name === name), now: s });
  }
  const { results: events } = await env.DB.prepare("SELECT rule, who, win, action, at FROM limit_events ORDER BY at DESC, id DESC LIMIT 100").all();
  const { results: flagged } = await env.DB.prepare("SELECT who, GROUP_CONCAT(DISTINCT rule) AS rules, MAX(at) AS last, COUNT(*) AS times FROM limit_events WHERE action = 'flag' GROUP BY who ORDER BY last DESC").all();
  return json({ rules: out, events, flagged: (flagged as { who: string; rules: string; last: number; times: number }[]).map((f) => ({ ...f, rules: f.rules.split(",") })) });
}
