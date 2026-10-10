// Rate limits on what costs money or invites abuse: signing in and up, digging
// up repos (Artifacts imports), the GitHub calls the site's token pays for,
// commits (Artifacts pushes), preview and deploy runs, and the things a
// spammer would make by the thousand. Each rule counts per caller (their
// handle, else their IP) in fixed windows, in D1. Admins tune them from the
// drawer (GET|PUT /api/admin/limits).
//
// Only requests from the internet are counted: Cloudflare stamps those with
// cf-connecting-ip. The desktop, the tests, and the Worker's own calls (hosted
// agents, the dependency doctor) carry none. Admins are never limited.

import { json, type Env } from "./env.ts";

export interface Rule { name: string; label: string; what: string; per: "ip" | "user"; max: number; window_s: number }

const MIN = 60, HOUR = 3600, DAY = 86400;
export const RULES: Rule[] = [
  { name: "signin", label: "Sign in", what: "password and social sign-ins", per: "ip", max: 10, window_s: 10 * MIN },
  { name: "signup", label: "Create account", what: "new email accounts", per: "ip", max: 5, window_s: HOUR },
  { name: "handle", label: "Claim a handle", what: "picking your @handle", per: "ip", max: 10, window_s: HOUR },
  { name: "dig", label: "Dig up a repo", what: "GitHub digs and level forks (Artifacts imports)", per: "user", max: 5, window_s: HOUR },
  { name: "github", label: "GitHub lookups", what: "repo lists and search, on the site's GitHub token", per: "user", max: 30, window_s: MIN },
  { name: "search", label: "Code search", what: "full-text search over committed code", per: "user", max: 30, window_s: MIN },
  { name: "repo", label: "New repos", what: "empty repos made here", per: "user", max: 10, window_s: DAY },
  { name: "file", label: "New files", what: "files added to a repo", per: "user", max: 120, window_s: HOUR },
  { name: "commit", label: "Commits", what: "pushes to Artifacts", per: "user", max: 60, window_s: HOUR },
  { name: "share", label: "Shares and collections", what: "share links, collections and tracks", per: "user", max: 60, window_s: HOUR },
  { name: "agent", label: "Coding agents", what: "hosted agent runs, on the site's API keys", per: "user", max: 20, window_s: DAY },
  { name: "run", label: "Previews and deploys", what: "preview and deploy runs, on the site's cloud logins", per: "user", max: 20, window_s: DAY },
];

/** Which rule a request counts against, if any. */
export function ruleFor(method: string, p: string[]): string | null {
  if (method === "GET") {
    if (p[1] === "github" && (p[2] === "repos" || p[2] === "search")) return "github";
    if (p[1] === "search") return "search";
    return null;
  }
  if (method !== "POST") return null;
  if (p[1] === "auth") return p[2] === "sign-in" ? "signin" : p[2] === "sign-up" ? "signup" : null;
  if (p[1] === "handle") return "handle";
  if (p[1] === "github" && p[2] === "dig") return "dig";
  if (p[1] === "levels" && p[3] === "fork") return "dig";
  if (p[1] === "playlists") return "share";
  if (p[1] === "repos" && !p[2]) return "repo";
  if (p[1] === "repos" && p[4] === "files") return "file";
  if (p[1] === "repos" && p[4] === "shares") return "share";
  if (p[1] === "repos" && p[4] === "agents") return "agent";
  if (p[1] === "repos" && (p[4] === "preview" || p[4] === "deploy") && !p[5]) return "run";
  if (p[1] === "repos" && p[4] === "do" && p[5] === "commit") return "commit";
  return null;
}

// An admin's changes, read at most every 30 seconds per isolate.
let cache: { at: number; env: object; rules: Map<string, Rule & { enabled: boolean }> } | null = null;
async function rules(env: Env) {
  if (cache && cache.env === env && Date.now() - cache.at < 30_000) return cache.rules;
  const { results } = await env.DB.prepare("SELECT name, max, window_s, enabled FROM limit_rules").all();
  const saved = new Map((results as { name: string; max: number; window_s: number; enabled: number }[]).map((r) => [r.name, r]));
  const out = new Map(RULES.map((r) => {
    const s = saved.get(r.name);
    return [r.name, { ...r, ...(s ? { max: s.max, window_s: s.window_s } : {}), enabled: s ? !!s.enabled : true }];
  }));
  cache = { at: Date.now(), env, rules: out };
  return out;
}

const ipOf = (req: Request) => req.headers.get("cf-connecting-ip");

/** A 429 when this caller is over the rule's limit, else null (and the hit is counted). */
export async function limit(req: Request, env: Env, rule: string | null, user: string | null, admin: boolean): Promise<Response | null> {
  const ip = ipOf(req);
  if (!rule || !ip || admin) return null;
  const r = (await rules(env)).get(rule);
  if (!r?.enabled) return null;
  const who = r.per === "user" && user ? `@${user}` : ip;
  const span = r.window_s * 1000, win = Math.floor(Date.now() / span) * span;
  const row = await env.DB.prepare(
    "INSERT INTO limit_hits (rule, who, win, count) VALUES (?, ?, ?, 1) ON CONFLICT (rule, who, win) DO UPDATE SET count = count + 1 RETURNING count")
    .bind(rule, who, win).first();
  if ((row?.count as number) <= r.max) return null;
  const wait = Math.ceil((win + span - Date.now()) / 1000);
  return json({ error: `Slow down: ${r.label.toLowerCase()} is limited to ${r.max} per ${every(r.window_s)}. Try again in ${every(wait)}.` }, 429, { "retry-after": String(wait) });
}

/** "10 minutes", "hour", "2 days". */
export function every(s: number) {
  const [n, unit] = s % DAY === 0 ? [s / DAY, "day"] : s % HOUR === 0 ? [s / HOUR, "hour"] : s >= MIN ? [Math.ceil(s / MIN), "minute"] : [s, "second"];
  return n === 1 ? unit : `${n} ${unit}s`;
}

/** The hourly cron: drop windows that have ended. */
export async function sweepLimits(env: Env, now = Date.now()) {
  const longest = Math.max(...[...(await rules(env)).values()].map((r) => r.window_s)) * 1000;
  await env.DB.prepare("DELETE FROM limit_hits WHERE win < ?").bind(now - longest).run();
}

/**
 * GET /api/admin/limits  every rule with this window's traffic: callers, hits, and who's blocked.
 * PUT /api/admin/limits {rules: [{name, max, window_s, enabled}]}
 */
export async function limitRoutes(req: Request, env: Env, p: string[], admin: boolean): Promise<Response | null> {
  if (p[1] !== "admin" || p[2] !== "limits") return null;
  if (!admin) return json({ error: "admins only" }, 403);
  if (req.method === "PUT") {
    const b = (await req.json().catch(() => ({}))) as { rules?: { name: string; max: number; window_s: number; enabled: boolean }[] };
    for (const r of b.rules ?? []) {
      if (!RULES.some((d) => d.name === r.name)) return json({ error: `no rule ${r.name}` }, 400);
      if (!(Number.isInteger(r.max) && r.max >= 1 && r.max <= 100_000)) return json({ error: `${r.name}: max is a whole number, 1 to 100000` }, 400);
      if (!(Number.isInteger(r.window_s) && r.window_s >= 1 && r.window_s <= 30 * DAY)) return json({ error: `${r.name}: the window is 1 second to 30 days` }, 400);
    }
    await env.DB.batch((b.rules ?? []).map((r) => env.DB.prepare("INSERT OR REPLACE INTO limit_rules (name, max, window_s, enabled) VALUES (?, ?, ?, ?)").bind(r.name, r.max, r.window_s, r.enabled ? 1 : 0)));
    cache = null;
  } else if (req.method !== "GET") return null;
  const now = Date.now();
  const out = [];
  for (const r of (await rules(env)).values()) {
    const span = r.window_s * 1000, win = Math.floor(now / span) * span;
    const s = await env.DB.prepare("SELECT COUNT(*) AS callers, COALESCE(SUM(count), 0) AS hits, COALESCE(SUM(count > ?), 0) AS blocked FROM limit_hits WHERE rule = ? AND win = ?")
      .bind(r.max, r.name, win).first();
    const { name, label, what, per, max, window_s, enabled } = r;
    out.push({ name, label, what, per, max, window_s, enabled, defaults: RULES.find((d) => d.name === name), now: s });
  }
  return json({ rules: out });
}
