// Insights, for admins (#/admin/insights, GET /api/admin/insights): who's really
// here, people or agents; how the site is holding up; and how far each person
// has got along the way in.
//
// Every request from the internet (Cloudflare stamps those with cf-connecting-ip,
// like limits.ts counts) is tallied per day, per caller, by what it looks like:
//   person  a browser: a Mozilla user agent that sends the sec-fetch-* headers browsers add
//   agent   an API token or OAuth app, MCP, a script (curl, python, node…), or a
//           "browser" without the headers a real one sends (headless, or a spoofed agent)
//   bot     a crawler or uptime checker that says so
// A signed-in caller counts as their @handle; a signed-out one as a hash of their
// IP salted with the day (and BETTER_AUTH_SECRET), so no IP is kept and no one is
// followed from one day to the next. Days older than 30 are swept every hour.
//
// A person's steps (made a repo, wrote code, committed, shared, ran an agent,
// deployed) are noted the first and last time a request for one succeeds.

import { json, type Env } from "./env.ts";
import { actingAs, identify } from "./identity.ts";
import { ruleFor } from "./limits.ts";

const DAY = 86_400_000, KEEP_DAYS = 30;

/** Who each request turned out to be: the worker notes it once it's known. */
export const callers = new WeakMap<Request, string | null>();

export type Kind = "person" | "agent" | "bot";
const BOT = /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|embedly|preview|uptime|monitor|pingdom|statuscake|lighthouse/i;
const HEADLESS = /headless|phantomjs|playwright|puppeteer|selenium|webdriver/i;
const SCRIPT = /^(curl|wget|httpie|python|aiohttp|httpx|go-http|okhttp|java|ruby|php|node|undici|axios|got|bun|deno|postman|insomnia|rust|reqwest)|claude|anthropic|openai|chatgpt|gpt|perplexity|mcp|langchain/i;

/** What a request looks like: a person in a browser, an agent, or a bot. */
export function classify(req: Request, p: string[]): { kind: Kind; via: string } {
  const ua = req.headers.get("user-agent") ?? "";
  if (p[1] === "mcp") return { kind: "agent", via: "mcp" };
  if (/^bearer /i.test(req.headers.get("authorization") ?? "")) return { kind: "agent", via: "token" };
  if (BOT.test(ua)) return { kind: "bot", via: "crawler" };
  if (HEADLESS.test(ua)) return { kind: "agent", via: "headless" };
  if (!ua || SCRIPT.test(ua)) return { kind: "agent", via: "script" };
  if (/^Mozilla\//.test(ua) && req.headers.has("sec-fetch-mode")) return { kind: "person", via: "browser" };
  return { kind: "agent", via: "headless" };
}

// The way in, in order. Each counts when a request for it succeeds.
export const STEPS = [
  { step: "joined", label: "Signed in" },
  { step: "repo", label: "Made or dug up a repo" },
  { step: "code", label: "Wrote code" },
  { step: "commit", label: "Committed" },
  { step: "share", label: "Shared or collected" },
  { step: "agent", label: "Ran an agent" },
  { step: "deploy", label: "Deployed" },
] as const;
const STEP_OF: Record<string, string> = { dig: "repo", repo: "repo", file: "code", edit: "code", commit: "commit", share: "share", agent: "agent", preview: "deploy", deploy: "deploy" };

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function ipHash(env: Env, ip: string, day: number) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${day}:${ip}:${env.BETTER_AUTH_SECRET ?? ""}`))).slice(0, 12);
}

/** Tally one answered request (only those from the internet; not the Worker's own calls). */
export async function record(env: Env, req: Request, status: number) {
  const ip = req.headers.get("cf-connecting-ip");
  if (!ip || actingAs.has(req)) return;
  const p = new URL(req.url).pathname.split("/").filter(Boolean).map(decodeURIComponent);
  // Routes that answer before the worker knows who's calling (the session, signing in) are looked up here, after the answer's gone.
  let user = callers.has(req) ? callers.get(req)! : await identify(req, env).catch(() => null);
  // An account just deleted leaves nothing behind under its handle.
  if (req.method === "DELETE" && p[1] === "me" && !p[2] && status < 300) user = null;
  const now = Date.now(), day = now - (now % DAY);
  const { kind, via } = classify(req, p);
  const who = user ? `@${user}` : `ip:${await ipHash(env, ip, day)}`;
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 160) || null;
  const out = [env.DB.prepare(`INSERT INTO traffic (day, who, kind, via, hits, errors, first_at, last_at, ua) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT (day, who, kind, via) DO UPDATE SET hits = hits + 1, errors = errors + excluded.errors, last_at = excluded.last_at, ua = excluded.ua`)
    .bind(day, who, kind, via, status >= 500 ? 1 : 0, now, now, ua)];
  if (user) {
    out.push(env.DB.prepare("INSERT OR IGNORE INTO user_steps (name, step, first_at, last_at, n) VALUES (?, 'joined', ?, ?, 1)").bind(user, now, now));
    const step = status < 300 ? STEP_OF[ruleFor(req.method, p) ?? ""] : undefined;
    if (step) out.push(env.DB.prepare(`INSERT INTO user_steps (name, step, first_at, last_at, n) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT (name, step) DO UPDATE SET last_at = excluded.last_at, n = n + 1`).bind(user, step, now, now));
  }
  await env.DB.batch(out).catch((e: unknown) => console.error("codeSplitters: traffic tally failed", String((e as Error)?.message ?? e)));
}

/** Hourly: traffic older than 30 days. */
export async function sweepTraffic(env: Env, now = Date.now()) {
  await env.DB.prepare("DELETE FROM traffic WHERE day < ?").bind(now - KEEP_DAYS * DAY).run()
    .catch((e: unknown) => console.error("codeSplitters: traffic sweep failed", String((e as Error)?.message ?? e)));
}

type Check = { name: string; state: "ok" | "warn" | "bad"; detail: string };
const n = (x: unknown) => Number(x ?? 0);
const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;

/** A quick look at each part that can go wrong, over the last day. A table that isn't there is skipped. */
async function health(env: Env, now: number): Promise<{ db_ms: number; checks: Check[] }> {
  const since = now - DAY, t0 = Date.now();
  await env.DB.prepare("SELECT 1").first();
  const db_ms = Date.now() - t0;
  const first = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first().catch(() => null) as Promise<Record<string, unknown> | null>;
  const checks: Check[] = [{ name: "Database", state: db_ms > 500 ? "warn" : "ok", detail: `answered in ${db_ms} ms` }];
  const api = await first("SELECT SUM(hits) AS hits, SUM(errors) AS errors FROM traffic WHERE last_at >= ?", since);
  if (api) {
    const hits = n(api.hits), errors = n(api.errors), rate = hits ? errors / hits : 0;
    checks.push({ name: "API errors", state: rate > 0.1 ? "bad" : rate > 0.02 ? "warn" : "ok", detail: `${plural(errors, "server error")} in ${plural(hits, "request")}` });
  }
  const runs = (name: string, row: Record<string, unknown> | null, stuck = 0) => {
    if (!row) return;
    const total = n(row.total), failed = n(row.failed);
    checks.push({ name, state: stuck || (total && failed / total > 0.5) ? "bad" : failed ? "warn" : "ok",
      detail: `${plural(total, "run")}, ${failed} failed${stuck ? `, ${stuck} stuck over an hour` : ""}` });
  };
  const agents = await first("SELECT COUNT(*) AS total, SUM(status = 'failed') AS failed, SUM(status = 'running' AND started < ?) AS stuck FROM agent_runs WHERE started >= ?", now - 3_600_000, since);
  runs("Agent runs", agents, n(agents?.stuck));
  const deploys = await first("SELECT COUNT(*) AS total, SUM(status = 'failed') AS failed, SUM(status = 'running' AND at < ?) AS stuck FROM deploys WHERE at >= ?", now - 3_600_000, since);
  runs("Deploys and previews", deploys, n(deploys?.stuck));
  runs("Checks", await first("SELECT COUNT(*) AS total, SUM(status = 'failed') AS failed FROM check_runs WHERE created_at >= ?", since));
  runs("Webhooks", await first("SELECT COUNT(*) AS total, SUM(status = 'failed') AS failed FROM webhook_deliveries WHERE at >= ?", since));
  const jobs = await first("SELECT COUNT(*) AS waiting, MIN(at) AS oldest FROM limit_jobs WHERE state = 'waiting'");
  if (jobs) {
    const waiting = n(jobs.waiting), wait = waiting ? now - n(jobs.oldest) : 0;
    checks.push({ name: "Queued requests", state: wait > 3_600_000 ? "bad" : wait > 900_000 ? "warn" : "ok", detail: waiting ? `${waiting} waiting, the oldest ${Math.round(wait / 60_000)} min` : "none waiting" });
  }
  const over = await first("SELECT COUNT(*) AS n, COUNT(DISTINCT who) AS callers FROM limit_events WHERE at >= ?", since);
  if (over) checks.push({ name: "Rate limits", state: n(over.n) > 20 ? "warn" : "ok", detail: `${plural(n(over.callers), "caller")} went over ${plural(n(over.n), "time")}` });
  const levels = await first("SELECT SUM(status = 'failed') AS failed, SUM(status = 'importing') AS importing FROM levels");
  if (levels) checks.push({ name: "Level imports", state: n(levels.failed) ? "warn" : "ok", detail: `${n(levels.failed)} failed, ${n(levels.importing)} digging` });
  return { db_ms, checks };
}

/**
 * GET /api/admin/insights?days=7  traffic by day and kind, the last day's callers,
 * the people most recently here with how far each has got, and the site's health.
 */
export async function insightRoutes(req: Request, env: Env, p: string[], url: URL, admin: boolean): Promise<Response | null> {
  if (p[1] !== "admin" || p[2] !== "insights" || p[3]) return null;
  if (!admin) return json({ error: "admins only" }, 403);
  if (req.method !== "GET") return json({ error: "GET only" }, 405);
  const now = Date.now(), days = Math.min(KEEP_DAYS, Math.max(1, Number(url.searchParams.get("days")) || 7));
  const from = now - (now % DAY) - (days - 1) * DAY;
  const all = async (sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all()).results as Record<string, any>[];

  const byDay = await all("SELECT day, kind, SUM(hits) AS hits, COUNT(DISTINCT who) AS callers FROM traffic WHERE day >= ? GROUP BY day, kind ORDER BY day", from);
  const byVia = await all("SELECT kind, via, SUM(hits) AS hits, SUM(errors) AS errors, COUNT(DISTINCT who) AS callers FROM traffic WHERE day >= ? GROUP BY kind, via ORDER BY hits DESC", from);
  const kinds = Object.fromEntries((["person", "agent", "bot"] as const).map((k) => {
    const rows = byVia.filter((r) => r.kind === k);
    return [k, { hits: rows.reduce((s, r) => s + n(r.hits), 0), errors: rows.reduce((s, r) => s + n(r.errors), 0) }];
  }));
  for (const r of await all("SELECT kind, COUNT(DISTINCT who) AS callers FROM traffic WHERE day >= ? GROUP BY kind", from)) (kinds[r.kind] as any).callers = n(r.callers);
  const callersNow = await all(`SELECT who, kind, via, SUM(hits) AS hits, SUM(errors) AS errors, MAX(last_at) AS last_at, MAX(ua) AS ua
    FROM traffic WHERE last_at >= ? GROUP BY who, kind, via ORDER BY last_at DESC LIMIT 40`, now - DAY);

  const people = await all(`SELECT u.name,
      (SELECT MIN(first_at) FROM user_steps s WHERE s.name = u.name) AS joined,
      (SELECT MAX(last_at) FROM traffic t WHERE t.who = '@' || u.name) AS seen,
      (SELECT MAX(last_at) FROM user_steps s WHERE s.name = u.name AND s.step != 'joined') AS acted
    FROM users u ORDER BY MAX(COALESCE(seen, 0), COALESCE(acted, 0), COALESCE(joined, 0)) DESC LIMIT 50`);
  const names = people.map((u) => u.name as string), marks = names.map(() => "?").join(",");
  const steps = names.length ? await all(`SELECT name, step, first_at, last_at, n FROM user_steps WHERE name IN (${marks})`, ...names) : [];
  const hits = names.length ? await all(`SELECT who, kind, SUM(hits) AS hits FROM traffic WHERE day >= ? AND who IN (${marks}) GROUP BY who, kind`, from, ...names.map((x) => `@${x}`)) : [];
  const users = people.map((u) => {
    const mine = Object.fromEntries(steps.filter((s) => s.name === u.name).map((s) => [s.step, { first_at: s.first_at, last_at: s.last_at, n: s.n }]));
    const furthest = [...STEPS].reverse().find((s) => mine[s.step])?.step ?? null;
    const h = Object.fromEntries(hits.filter((r) => r.who === `@${u.name}`).map((r) => [r.kind, n(r.hits)]));
    return { name: u.name, joined: u.joined ?? null, last_seen: Math.max(n(u.seen), n(u.acted)) || null, steps: mine, furthest, hits: { person: h.person ?? 0, agent: h.agent ?? 0, bot: h.bot ?? 0 } };
  });
  // How many of everyone reached each step.
  const funnel = await all("SELECT step, COUNT(*) AS people FROM user_steps GROUP BY step");
  const total = n((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first())?.n);

  return json({
    generated_at: now, days, from,
    traffic: { kinds, by_day: byDay, by_via: byVia, callers: callersNow },
    steps: STEPS.map((s) => ({ ...s, people: n(funnel.find((f) => f.step === s.step)?.people) })),
    total_users: total,
    users,
    health: await health(env, now),
  });
}
