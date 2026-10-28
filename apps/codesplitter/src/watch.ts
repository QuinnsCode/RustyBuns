// The supply-chain watch (#614). On the hourly cron it keeps an eye on what the
// tools agents depend on are up to:
//
// - Each major agent platform's status page (Statuspage's /api/v2/status.json,
//   which incident.io's pages serve too), one line each.
// - Malicious-package advisories: OSV's MAL-… entries for npm (the OpenSSF
//   malicious-packages feed). OSV lists every entry by when it last changed,
//   newest first (modified_id.csv), so each hour reads only down to where it
//   stopped last time. Each new one is kept, and every repo's package.json files
//   (each workspace's too) are checked against all of them: a dependency whose
//   range could take a poisoned version is a hit, whatever its floor, and
//   whether or not the repo's dependency doctor is on.
//
// - Optional, news (#699): with WATCH_NEWS=1 and ANTHROPIC_API_KEY, once a day
//   Claude searches the web for compromised npm packages and reports each incident
//   it found a source for. It's unverified, so it only shows as news: it never
//   makes a hit the way an advisory does.
//
// A sweep of the repos goes on across hours if it runs out of time; one that
// finishes while newer advisories came in starts again.
//
//   GET /api/watch    the status lines, the news, and hits in your own repos

import Anthropic from "@anthropic-ai/sdk";
import { caller, mayTake, readManifests, type Call } from "./deps.ts";
import { json, type Env } from "./env.ts";

export const STATUS_PAGES = [
  { name: "Anthropic", url: "https://status.claude.com" },
  { name: "OpenAI", url: "https://status.openai.com" },
  { name: "GitHub", url: "https://www.githubstatus.com" },
  { name: "npm", url: "https://status.npmjs.org" },
  { name: "Cloudflare", url: "https://www.cloudflarestatus.com" },
];

const OSV = "https://api.osv.dev/v1";
const MODIFIED = "https://osv-vulnerabilities.storage.googleapis.com/npm/modified_id.csv";
/** The first time, how far back to start. */
export const FIRST_LOOK = 7 * 86_400_000;
/** The most advisories one hour takes in; the rest wait for the next. */
const MAX_NEW = 100;
/** How long a cron's sweep of the repos may go on before it picks up next hour. */
export const SWEEP_BUDGET = 5 * 60_000;

export interface Status { name: string; url: string; indicator: string; description: string; checked_at: number }
/** One malicious-package advisory, for one package. versions null: every version. */
export interface Mal { id: string; name: string; summary: string; versions: string[] | null }
export interface Hit { owner: string; repo: string; path: string; name: string; spec: string; id: string; summary: string; found_at: number }

const fetcher = (env: Env) => (env.WATCH_FETCH as typeof fetch | undefined) ?? fetch;

/** Ask every status page; one that doesn't answer reads "unknown". */
export async function pollStatus(env: Env, now = Date.now()): Promise<Status[]> {
  const get = fetcher(env);
  const out = await Promise.all(STATUS_PAGES.map(async ({ name, url }): Promise<Status> => {
    try {
      const r = await get(`${url}/api/v2/status.json`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(String(r.status));
      const { status } = (await r.json()) as { status?: { indicator?: string; description?: string } };
      return { name, url, indicator: status?.indicator ?? "unknown", description: status?.description ?? "", checked_at: now };
    } catch {
      return { name, url, indicator: "unknown", description: "didn't answer", checked_at: now };
    }
  }));
  await env.DB.batch(out.map((s) => env.DB.prepare("INSERT OR REPLACE INTO watch_status (name, url, indicator, description, checked_at) VALUES (?, ?, ?, ?, ?)")
    .bind(s.name, s.url, s.indicator, s.description, s.checked_at)));
  return out;
}

/**
 * The MAL ids changed after `since`, oldest first, at most MAX_NEW, and how far
 * that reaches. OSV lists newest first, so it reads only down to `since`.
 */
export async function changedSince(get: typeof fetch, since: string): Promise<{ ids: string[]; upTo: string }> {
  const r = await get(MODIFIED);
  if (!r.ok || !r.body) throw new Error(`osv modified_id.csv: ${r.status}`);
  const reader = r.body.getReader(), dec = new TextDecoder();
  const seen: [string, string][] = [];
  let newest = since, buf = "", done = false;
  while (!done) {
    const chunk = await reader.read();
    buf += chunk.done ? "\n" : dec.decode(chunk.value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      const [at, id] = line.trim().split(",");
      if (!at || !id) continue;
      if (at <= since) { done = true; break; }
      if (at > newest) newest = at;
      if (id.startsWith("MAL-")) seen.push([at, id]);
    }
    if (chunk.done) done = true;
  }
  await reader.cancel().catch(() => {});
  // Too many for one hour: the oldest go first, and the next hour picks up after them.
  const take = seen.reverse().slice(0, MAX_NEW);
  return { ids: take.map(([, id]) => id), upTo: seen.length > MAX_NEW ? take.at(-1)![0] : newest };
}

/** What one OSV entry says, per npm package. Withdrawn: nothing. */
export function malFrom(v: any): Mal[] {
  if (!v?.id || v.withdrawn) return [];
  return (v.affected ?? []).filter((a: any) => a.package?.ecosystem === "npm" && a.package?.name).map((a: any): Mal => {
    const listed: string[] = a.versions ?? [];
    // No list, or a range that starts at 0 and never ends: the whole package.
    const whole = !listed.length || (a.ranges ?? []).some((r: any) => {
      const ev = r.events ?? [];
      return ev.some((e: any) => e.introduced === "0") && !ev.some((e: any) => e.fixed || e.last_affected);
    });
    return { id: v.id, name: a.package.name, summary: v.summary ?? v.details?.slice(0, 200) ?? "", versions: whole ? null : listed };
  });
}

/** Which dependencies in these package.json files could install a poisoned version. */
export function hitsIn(manifests: Map<string, { pkg: Record<string, any> }>, mal: Map<string, Mal[]>): Omit<Hit, "owner" | "repo" | "found_at">[] {
  const out: Omit<Hit, "owner" | "repo" | "found_at">[] = [];
  for (const [path, { pkg }] of manifests) {
    const deps = { ...pkg.optionalDependencies, ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies } as Record<string, string>;
    for (const [name, spec] of Object.entries(deps)) {
      if (/^(workspace|file|link|portal):/.test(String(spec))) continue;
      for (const m of mal.get(name) ?? []) {
        if (!m.versions || m.versions.some((v) => mayTake(String(spec), v))) out.push({ path, name, spec: String(spec), id: m.id, summary: m.summary });
      }
    }
  }
  return out;
}

/** Check one repo against every advisory kept, and keep its hits (when each was first found stays). */
export async function checkRepo(env: Env, call: Call, owner: string, repo: string, mal: Map<string, Mal[]>, now = Date.now()): Promise<Hit[]> {
  const found = await readManifests(call, owner, repo);
  const hits = "note" in found ? [] : hitsIn(found.manifests, mal);
  const { results } = await env.DB.prepare("SELECT path, name, id, found_at FROM mal_hits WHERE owner = ? AND repo = ?").bind(owner, repo).all<any>();
  const was = new Map(results.map((h) => [`${h.path}\0${h.name}\0${h.id}`, h.found_at as number]));
  const out = hits.map((h) => ({ owner, repo, ...h, found_at: was.get(`${h.path}\0${h.name}\0${h.id}`) ?? now }));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM mal_hits WHERE owner = ? AND repo = ?").bind(owner, repo),
    ...out.map((h) => env.DB.prepare("INSERT OR IGNORE INTO mal_hits (owner, repo, path, name, spec, id, summary, found_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(owner, repo, h.path, h.name, h.spec, h.id, h.summary, h.found_at)),
  ]);
  return out;
}

/** Where the watch has got to: OSV's list read down to `since`; a sweep under way past `after` (null: none); `again` once it ends. */
interface State { since: string; after: [string, string] | null; again: boolean }

async function state(env: Env, now: number): Promise<State> {
  const r = await env.DB.prepare("SELECT value FROM watch_state WHERE key = 'mal'").first<{ value: string }>();
  return r ? JSON.parse(r.value) : { since: new Date(now - FIRST_LOOK).toISOString(), after: null, again: false };
}
const save = (env: Env, s: State) => env.DB.prepare("INSERT OR REPLACE INTO watch_state (key, value) VALUES ('mal', ?)").bind(JSON.stringify(s)).run();

/** Take in the advisories that changed since last time. Returns how many npm packages they name. */
export async function takeNewMal(env: Env, s: State, now = Date.now()): Promise<number> {
  const get = fetcher(env);
  const { ids, upTo } = await changedSince(get, s.since);
  const entries = await Promise.all(ids.map((id) => get(`${OSV}/vulns/${encodeURIComponent(id)}`).then((r) => r.ok ? r.json() : null).catch(() => null)));
  // One that didn't come back is tried again next hour.
  if (entries.some((e) => !e)) return 0;
  const mal = entries.flatMap(malFrom);
  await env.DB.batch([
    ...ids.map((id) => env.DB.prepare("DELETE FROM watch_mal WHERE id = ?").bind(id)),
    ...mal.map((m) => env.DB.prepare("INSERT OR REPLACE INTO watch_mal (id, name, summary, versions, at) VALUES (?, ?, ?, ?, ?)")
      .bind(m.id, m.name, m.summary, m.versions ? JSON.stringify(m.versions) : null, now)),
  ]);
  s.since = upTo;
  return ids.length;
}

async function allMal(env: Env): Promise<Map<string, Mal[]>> {
  const { results } = await env.DB.prepare("SELECT id, name, summary, versions FROM watch_mal").all<any>();
  const out = new Map<string, Mal[]>();
  for (const r of results) out.set(r.name, [...(out.get(r.name) ?? []), { id: r.id, name: r.name, summary: r.summary, versions: r.versions ? JSON.parse(r.versions) : null }]);
  return out;
}

/** One incident from the news search: unverified, with the page it came from. */
export interface News { url: string; title: string; packages: string[]; summary: string; published: string | null; at: number }

/** How often the news search runs, and how long its finds are kept. */
export const NEWS_EVERY = 86_400_000;
export const NEWS_KEEP = 30 * 86_400_000;
const NEWS_MODEL = "claude-opus-5-5";
/** Searches one run may make: what bounds its cost. */
const NEWS_SEARCHES = 5;

const REPORT: Anthropic.Beta.BetaTool = {
  name: "report",
  description: "Report the incidents found. Call it once, at the end, with every incident (an empty list when there are none).",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["incidents"],
    properties: {
      incidents: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "url", "packages", "summary", "published"],
          properties: {
            title: { type: "string", description: "A short headline for the incident." },
            url: { type: "string", description: "The search result it came from, exactly as the search gave it." },
            packages: { type: "array", items: { type: "string" }, description: "The npm package names it says were compromised." },
            summary: { type: "string", description: "One sentence: what happened, and which versions if the source says." },
            published: { type: "string", description: "When the source was published, YYYY-MM-DD, or empty if it doesn't say." },
          },
        },
      },
    },
  },
};

/**
 * Ask Claude, with web search, for this week's news of compromised npm packages.
 * Only incidents whose url was one of the search's results are kept, so each has
 * a real page behind it; what the page says is still unchecked.
 */
export async function searchNews(env: Env, now = Date.now()): Promise<News[]> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, fetch: fetcher(env), maxRetries: 1, timeout: 5 * 60_000 });
  const today = new Date(now).toISOString().slice(0, 10);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{
    role: "user",
    content: `Today is ${today}. Search the web for news from the past 7 days of npm packages that were compromised, hijacked or published with malicious code (a supply-chain attack). ` +
      `Then call the report tool once with each distinct incident, citing the search result it came from. Report only what a search result says; an empty list is fine.`,
  }];
  const seen = new Set<string>();
  // A search can pause the turn; carry on from where it stopped, a few times at most.
  for (let turn = 0; turn < 4; turn++) {
    const res = await client.beta.messages.create({
      model: NEWS_MODEL,
      max_tokens: 16_000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: NEWS_SEARCHES }, REPORT],
      messages,
    });
    for (const b of res.content) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) seen.add(r.url);
    }
    const call = res.content.find((b) => b.type === "tool_use" && b.name === "report");
    if (call?.type === "tool_use") return newsFrom(call.input, seen, now);
    if (res.stop_reason !== "pause_turn") return [];
    messages.push({ role: "assistant", content: res.content });
  }
  return [];
}

/** The report tool's incidents, each kept only when its url was a search result. */
export function newsFrom(input: unknown, seen: Set<string>, now: number): News[] {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const out = new Map<string, News>();
  for (const i of ((input as any)?.incidents ?? []) as any[]) {
    const url = str(i?.url, 2000);
    if (!seen.has(url) || !/^https?:\/\//.test(url) || out.has(url)) continue;
    const packages = (Array.isArray(i.packages) ? i.packages : []).map((p: unknown) => str(p, 214)).filter(Boolean).slice(0, 20);
    const published = /^\d{4}-\d{2}-\d{2}$/.test(str(i.published, 10)) ? str(i.published, 10) : null;
    out.set(url, { url, title: str(i.title, 200) || url, packages, summary: str(i.summary, 500), published, at: now });
  }
  return [...out.values()];
}

/** The news search, when it's on and a day has passed since it last ran. Returns how many it found, or null when it didn't run. */
export async function takeNews(env: Env, now = Date.now()): Promise<number | null> {
  if (env.WATCH_NEWS !== "1" || !env.ANTHROPIC_API_KEY) return null;
  const r = await env.DB.prepare("SELECT value FROM watch_state WHERE key = 'news'").first<{ value: string }>();
  if (r && now - JSON.parse(r.value).at < NEWS_EVERY) return null;
  // Booked before it runs: one that fails waits a day too, so a broken run never costs more than one a day.
  await env.DB.prepare("INSERT OR REPLACE INTO watch_state (key, value) VALUES ('news', ?)").bind(JSON.stringify({ at: now })).run();
  const found = await searchNews(env, now);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM watch_news WHERE at < ?").bind(now - NEWS_KEEP),
    // A story seen before keeps the day it was first found.
    ...found.map((n) => env.DB.prepare("INSERT OR IGNORE INTO watch_news (url, title, packages, summary, published, at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(n.url, n.title, JSON.stringify(n.packages), n.summary, n.published, n.at)),
  ]);
  return found.length;
}

export const newsLines = async (env: Env): Promise<News[]> =>
  ((await env.DB.prepare("SELECT * FROM watch_news ORDER BY at DESC, published DESC LIMIT 20").all<any>()).results)
    .map((n) => ({ ...n, packages: JSON.parse(n.packages) }));

/** The hourly cron: the status pages, new advisories, a sweep of the repos while there's time, and the daily news search. */
export async function scheduledWatch(env: Env, self: (r: Request) => Promise<Response>, now = Date.now(), budgetMs = SWEEP_BUDGET) {
  const deadline = Date.now() + budgetMs;
  await pollStatus(env, now).catch(() => {});
  const s = await state(env, now);
  const fresh = await takeNewMal(env, s, now).catch(() => 0);
  if (fresh) { if (s.after) s.again = true; else s.after = ["", ""]; }
  if (s.after) {
    const mal = await allMal(env);
    const call = caller(self, "http://codesplitter.local");
    const [o, n] = s.after;
    const { results } = await env.DB.prepare("SELECT owner, name FROM repos WHERE owner > ? OR (owner = ? AND name > ?) ORDER BY owner, name").bind(o, o, n).all<{ owner: string; name: string }>();
    let finished = true;
    for (const r of results) {
      if (Date.now() >= deadline) { finished = false; break; }
      // One that can't be read (the Worker's out of requests, say) is where the next hour starts.
      if (!(await checkRepo(env, call, r.owner, r.name, mal, now).then(() => true, () => false))) { finished = false; break; }
      s.after = [r.owner, r.name];
    }
    if (finished) { s.after = s.again ? ["", ""] : null; s.again = false; }
  }
  await save(env, s);
  await takeNews(env, now).catch(() => {});
}

export const statusLines = async (env: Env) =>
  ((await env.DB.prepare("SELECT name, url, indicator, description, checked_at FROM watch_status").all<Status>()).results)
    .sort((a, b) => STATUS_PAGES.findIndex((p) => p.name === a.name) - STATUS_PAGES.findIndex((p) => p.name === b.name));

export const hitsFor = async (env: Env, owner: string, repo?: string) =>
  (await env.DB.prepare(`SELECT * FROM mal_hits WHERE owner = ?${repo ? " AND repo = ?" : ""} ORDER BY found_at DESC`).bind(...(repo ? [owner, repo] : [owner])).all<Hit>()).results;

export async function watchRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (!(p[1] === "watch" && !p[2] && req.method === "GET")) return null;
  return json({ status: await statusLines(env), news: await newsLines(env), hits: user ? await hitsFor(env, user) : [] });
}
