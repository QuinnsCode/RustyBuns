// Rate limits on what costs money or invites abuse: signing in and up, digging
// up repos (Artifacts imports), the GitHub calls the site's token pays for,
// commits (Artifacts pushes), live line edits, and the things a spammer would
// make by the thousand. Each rule counts per caller (their handle, else their IP) in fixed
// windows, in D1. Admins tune them on the rate limits page (#/admin/limits,
// GET|PUT /api/admin/limits): each rule's cap and window, and what happens to a
// caller over it: reject (a 429), log (let it through, note it), or flag (let it
// through, and list the caller at the top of the page). The first time a caller
// goes over in a window is logged either way, and an admin can reset a caller.
//
// Only requests from the internet are counted: Cloudflare stamps those with
// cf-connecting-ip. The desktop, the tests, and the Worker's own calls (hosted
// agents, the dependency doctor) carry none. Admins are never limited.
//
// Edits sent over a file's WebSocket skip the Worker, so the Worker works out
// who a socket counts as when it opens (or that it isn't counted) and the
// file's DO counts each edit with countHit.

import { json, type Env } from "./env.ts";

export const ACTIONS = ["reject", "log", "flag"] as const;
export type Action = (typeof ACTIONS)[number];
export interface Rule { name: string; label: string; what: string; group: string; per: "ip" | "user"; max: number; window_s: number; on_fail: Action }

const MIN = 60, HOUR = 3600, DAY = 86400;
export const RULES: Rule[] = [
  { name: "signin", label: "Sign in", what: "password and social sign-ins", group: "Accounts", per: "ip", max: 10, window_s: 10 * MIN, on_fail: "reject" },
  { name: "signup", label: "Create account", what: "new email accounts", group: "Accounts", per: "ip", max: 5, window_s: HOUR, on_fail: "reject" },
  { name: "mail", label: "Account email", what: "verification and password reset emails sent", group: "Accounts", per: "ip", max: 5, window_s: HOUR, on_fail: "reject" },
  { name: "handle", label: "Claim a handle", what: "picking your @handle", group: "Accounts", per: "ip", max: 10, window_s: HOUR, on_fail: "reject" },
  { name: "dig", label: "Dig up a repo", what: "GitHub digs and level forks (Artifacts imports)", group: "GitHub", per: "user", max: 5, window_s: HOUR, on_fail: "reject" },
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
  if (r.on_fail !== "reject") return null;
  const wait = Math.ceil((win + span - Date.now()) / 1000);
  return { error: `Slow down: ${r.label.toLowerCase()} is limited to ${r.max} per ${every(r.window_s)}. Try again in ${every(wait)}.`, wait };
}

/** A 429 when this caller is over the rule's limit, else null (and the hit is counted). */
export async function limit(req: Request, env: Env, rule: string | null, user: string | null, admin: boolean): Promise<Response | null> {
  const who = counted(req, rule, user, admin);
  const over = who ? await countHit(env, rule!, who) : null;
  return over && json({ error: over.error }, 429, { "retry-after": String(over.wait) });
}

/** "10 minutes", "hour", "2 days". */
export function every(s: number) {
  const [n, unit] = s % DAY === 0 ? [s / DAY, "day"] : s % HOUR === 0 ? [s / HOUR, "hour"] : s >= MIN ? [Math.ceil(s / MIN), "minute"] : [s, "second"];
  return n === 1 ? unit : `${n} ${unit}s`;
}

/** The hourly cron: drop windows that have ended, and log entries older than a week. */
export async function sweepLimits(env: Env, now = Date.now()) {
  const longest = Math.max(...[...(await rules(env)).values()].map((r) => r.window_s)) * 1000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM limit_hits WHERE win < ?").bind(now - longest),
    env.DB.prepare("DELETE FROM limit_events WHERE at < ?").bind(now - 7 * DAY * 1000),
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
    const { name, label, what, group, per, max, window_s, enabled, on_fail } = r;
    out.push({ name, label, what, group, per, max, window_s, enabled, on_fail, defaults: RULES.find((d) => d.name === name), now: s });
  }
  const { results: events } = await env.DB.prepare("SELECT rule, who, win, action, at FROM limit_events ORDER BY at DESC, id DESC LIMIT 100").all();
  const { results: flagged } = await env.DB.prepare("SELECT who, GROUP_CONCAT(DISTINCT rule) AS rules, MAX(at) AS last, COUNT(*) AS times FROM limit_events WHERE action = 'flag' GROUP BY who ORDER BY last DESC").all();
  return json({ rules: out, events, flagged: (flagged as { who: string; rules: string; last: number; times: number }[]).map((f) => ({ ...f, rules: f.rules.split(",") })) });
}
