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
// A sweep of the repos goes on across hours if it runs out of time; one that
// finishes while newer advisories came in starts again.
//
//   GET /api/watch    the status lines, and hits in your own repos

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
  const { results } = await env.DB.prepare("SELECT path, name, id, found_at FROM mal_hits WHERE owner = ? AND repo = ?").bind(owner, repo).all();
  const was = new Map((results as any[]).map((h) => [`${h.path}\0${h.name}\0${h.id}`, h.found_at as number]));
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
  const r = await env.DB.prepare("SELECT value FROM watch_state WHERE key = 'mal'").first();
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
  const { results } = await env.DB.prepare("SELECT id, name, summary, versions FROM watch_mal").all();
  const out = new Map<string, Mal[]>();
  for (const r of results as any[]) out.set(r.name, [...(out.get(r.name) ?? []), { id: r.id, name: r.name, summary: r.summary, versions: r.versions ? JSON.parse(r.versions) : null }]);
  return out;
}

/** The hourly cron: the status pages, new advisories, and a sweep of the repos while there's time. */
export async function scheduledWatch(env: Env, self: (r: Request) => Promise<Response>, now = Date.now(), budgetMs = SWEEP_BUDGET) {
  const deadline = Date.now() + budgetMs;
  await pollStatus(env, now).catch(() => {});
  const s = await state(env, now);
  const fresh = await takeNewMal(env, s, now).catch(() => 0);
  if (fresh) { if (s.after) s.again = true; else s.after = ["", ""]; }
  if (s.after) {
    const mal = await allMal(env);
    const call = caller(self, "http://codesplitters.local");
    const [o, n] = s.after;
    const { results } = await env.DB.prepare("SELECT owner, name FROM repos WHERE owner > ? OR (owner = ? AND name > ?) ORDER BY owner, name").bind(o, o, n).all();
    let finished = true;
    for (const r of results as { owner: string; name: string }[]) {
      if (Date.now() >= deadline) { finished = false; break; }
      // One that can't be read (the Worker's out of requests, say) is where the next hour starts.
      if (!(await checkRepo(env, call, r.owner, r.name, mal, now).then(() => true, () => false))) { finished = false; break; }
      s.after = [r.owner, r.name];
    }
    if (finished) { s.after = s.again ? ["", ""] : null; s.again = false; }
  }
  await save(env, s);
}

export const statusLines = async (env: Env) =>
  ((await env.DB.prepare("SELECT name, url, indicator, description, checked_at FROM watch_status").all()).results as unknown as Status[])
    .sort((a, b) => STATUS_PAGES.findIndex((p) => p.name === a.name) - STATUS_PAGES.findIndex((p) => p.name === b.name));

export const hitsFor = async (env: Env, owner: string, repo?: string) =>
  (await env.DB.prepare(`SELECT * FROM mal_hits WHERE owner = ?${repo ? " AND repo = ?" : ""} ORDER BY found_at DESC`).bind(...(repo ? [owner, repo] : [owner])).all()).results as unknown as Hit[];

export async function watchRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (!(p[1] === "watch" && !p[2] && req.method === "GET")) return null;
  return json({ status: await statusLines(env), hits: user ? await hitsFor(env, user) : [] });
}
