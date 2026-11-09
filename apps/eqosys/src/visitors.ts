// Visitors, for the super admin (the Visitors tab on the home page, and eq_visitors): who is really coming to eqosys, the
// Playground and the apps that call eqosys from their pages, and how eqosys is holding up. codeSplitter's insights, for the Q apps.
//
// Two ways a visit is counted, both into `visits` (migrations/0009_visits.sql), a row per caller, site and day:
//   - every request the Worker answers (worker.tsx), under the app whose page sent it (its Origin) or under eqosys;
//   - POST /api/visit, a beacon a page sends: "view" when a page with no Worker of its own opens (the Playground), and
//     "engaged" on the first tap, key or scroll (the Playground and eqosys's own pages).
// Each caller is sorted by its headers (@rustybuns/util/visitors): a person in a browser, an agent, or a bot. A person whose page
// saw a tap, a key or a scroll is "real": crawlers that run scripts don't touch the page, and headless browsers say so or lack
// the headers a browser sends. The caller is a hash of the IP and browser salted with the day and BETTER_AUTH_SECRET, so no IP
// is kept and nobody is followed from one day to the next. The super admin's own callers (marked when they open eqosys) are
// left out. Days older than 30 are swept.
import { bool, check, obj, opt, str } from "@rustybuns/util/guard";
import { sha256 } from "@rustybuns/util/bytes";
import { kindOf, type Kind } from "@rustybuns/util/visitors";
import { ourApp, APPS, HOME } from "./apps.ts";
import type { Env } from "./env.ts";

const DAY = 86_400_000, KEEP_DAYS = 30;
/** How long an isolate gathers visits before writing them: a row per caller a second, not a write per request. */
export const VISITS_MS = 1000;

const dayOf = (t: number) => t - (t % DAY);
async function whoOf(conf: Env, req: Request, day: number): Promise<string | null> {
  const ip = req.headers.get("cf-connecting-ip");
  if (!ip) return null;
  return (await sha256(`${day}:${ip}:${req.headers.get("user-agent") ?? ""}:${conf.BETTER_AUTH_SECRET ?? ""}`)).slice(0, 12);
}

/** Which site a request is for: the app whose page sent it, else eqosys. */
const originSite = (req: Request) => {
  const origin = req.headers.get("origin");
  return (origin && APPS.find((a) => a.origins.includes(origin))?.id) || HOME;
};

type Row = { day: number; site: string; who: string; kind: Kind; via: string; hits: number; engaged: number; errors: number; first_at: number; last_at: number; ua: string | null; ref: string | null };
type Batch = { rows: Map<string, Row>; done?: Promise<void> };
const batches = new WeakMap<object, Batch>();
let swept = 0;

async function write(conf: Env, b: Batch, now: number) {
  const out = [...b.rows.values()].map((r) => conf.DB.prepare(`INSERT INTO visits (day, site, who, kind, via, hits, engaged, errors, first_at, last_at, ua, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (day, site, who, kind, via) DO UPDATE SET hits = hits + excluded.hits, engaged = engaged + excluded.engaged, errors = errors + excluded.errors,
      last_at = MAX(last_at, excluded.last_at), ua = excluded.ua, ref = COALESCE(ref, excluded.ref)`)
    .bind(r.day, r.site, r.who, r.kind, r.via, r.hits, r.engaged, r.errors, r.first_at, r.last_at, r.ua, r.ref));
  // Once an hour an isolate sweeps the days past keeping.
  if (now - swept > 3_600_000) {
    swept = now;
    out.push(conf.DB.prepare("DELETE FROM visits WHERE day < ?").bind(dayOf(now) - KEEP_DAYS * DAY), conf.DB.prepare("DELETE FROM visit_staff WHERE day < ?").bind(dayOf(now) - KEEP_DAYS * DAY));
  }
  if (out.length) await conf.DB.batch(out).catch((e: unknown) => console.error("eqosys: visits write failed", String((e as Error)?.message ?? e)));
}

/**
 * Count one visit into the isolate's batch. With `later` (the Worker's waitUntil) the batch is written VISITS_MS after its first
 * visit, else straight away. Only requests from the internet count (Cloudflare stamps them with cf-connecting-ip).
 */
export async function count(conf: Env, req: Request, v: { site: string; hits: number; engaged: number; errors: number; ref?: string | null }, later?: (p: Promise<unknown>) => void) {
  const now = Date.now(), day = dayOf(now), who = await whoOf(conf, req, day);
  if (!who) return;
  const { kind, via } = kindOf(req.headers);
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 160) || null;
  let b = batches.get(conf.DB);
  if (!b) batches.set(conf.DB, b = { rows: new Map() });
  const key = `${day} ${v.site} ${who} ${kind} ${via}`, r = b.rows.get(key);
  if (r) r.hits += v.hits, r.engaged += v.engaged, r.errors += v.errors, r.last_at = now, r.ua = ua, r.ref ??= v.ref ?? null;
  else b.rows.set(key, { day, site: v.site, who, kind, via, hits: v.hits, engaged: v.engaged, errors: v.errors, first_at: now, last_at: now, ua, ref: v.ref ?? null });
  if (!later) {
    batches.delete(conf.DB);
    return write(conf, b, now);
  }
  const batch = b;
  if (!batch.done) {
    batch.done = new Promise<void>((ok) => setTimeout(ok, VISITS_MS)).then(() => {
      if (batches.get(conf.DB) === batch) batches.delete(conf.DB);
      return write(conf, batch, Date.now());
    });
    later(batch.done);
  }
}

/** One answered request (worker.tsx): counted under the app whose page sent it, or eqosys. The beacon counts itself. */
export function tally(conf: Env, req: Request, status: number, later?: (p: Promise<unknown>) => void) {
  if (new URL(req.url).pathname === "/api/visit") return;
  return count(conf, req, { site: originSite(req), hits: 1, engaged: 0, errors: status >= 500 ? 1 : 0 }, later);
}

const Beacon = obj({ site: str(64), engaged: opt(bool()), ref: opt(str(500)) });

/** Where a visitor came from: the referring site's host, unless it is the site itself. */
function refOf(ref: string | undefined, origin: string): string | null {
  try {
    const host = ref ? new URL(ref).host : "";
    return host && host !== new URL(origin).host ? host.slice(0, 100) : null;
  } catch { return null; }
}

/**
 * POST /api/visit { site, engaged?, ref? }, sent with navigator.sendBeacon (text/plain, so no preflight). The site must be eqosys
 * from its own pages, or an app from one of its own origins (apps.ts), so a page elsewhere can't fill another site's counts.
 */
export async function beacon(conf: Env, req: Request): Promise<Response> {
  const nothing = new Response(null, { status: 204 });
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const text = await req.text().catch(() => "");
  let parsed: unknown = null;
  try { parsed = JSON.parse(text.slice(0, 2000)); } catch { /* not JSON: refused below */ }
  const body = check(Beacon, parsed);
  const origin = req.headers.get("origin") ?? "";
  if (!body) return new Response(null, { status: 400 });
  const ours = body.site === HOME ? [new URL(req.url).origin, ...(conf.BETTER_AUTH_URL ? [new URL(conf.BETTER_AUTH_URL).origin] : [])] : ourApp(body.site)?.origins ?? [];
  if (!ours.includes(origin)) return new Response(null, { status: 403 });
  await count(conf, req, { site: body.site, hits: body.engaged ? 0 : 1, engaged: body.engaged ? 1 : 0, errors: 0, ref: refOf(body.ref, origin) });
  return nothing;
}

/** The super admin opened eqosys: this caller is theirs today, and stays out of the counts. */
export async function markStaff(conf: Env, req: Request) {
  const day = dayOf(Date.now()), who = await whoOf(conf, req, day);
  if (who) await conf.DB.prepare("INSERT OR IGNORE INTO visit_staff (day, who) VALUES (?, ?)").bind(day, who).run().catch(() => undefined);
}

export interface SiteCount { site: string; name: string; real: number; browsers: number; agents: number; bots: number; hits: number }
export interface DayCount { day: number; real: number; browsers: number; agents: number; bots: number }
export interface Caller { who: string; site: string; kind: string; via: string; hits: number; engaged: number; last_at: number; ua: string | null; ref: string | null }
export interface Visitors {
  generated_at: number; days: number; from: number;
  /** Distinct callers over the range, everywhere: real people (a browser that was tapped, typed or scrolled), every browser, agents, bots. */
  totals: { real: number; browsers: number; agents: number; bots: number; hits: number };
  sites: SiteCount[];
  by_day: DayCount[];
  /** Where real people came from: the referring site's host. */
  refs: { ref: string; real: number }[];
  /** The last day's callers, most recent first. */
  recent: Caller[];
  signups: number;
  health: { db_ms: number; hits: number; errors: number };
}

const SPLIT = `COUNT(DISTINCT CASE WHEN kind = 'person' AND engaged > 0 THEN who END) AS real, COUNT(DISTINCT CASE WHEN kind = 'person' THEN who END) AS browsers,
  COUNT(DISTINCT CASE WHEN kind = 'agent' THEN who END) AS agents, COUNT(DISTINCT CASE WHEN kind = 'bot' THEN who END) AS bots`;
// A caller is real for the whole day once any of its rows saw a tap: so the page view and the beacon need not share a row.
const FOLDED = `(SELECT day, site, who, kind, via, SUM(hits) AS hits, SUM(errors) AS errors, MAX(last_at) AS last_at, MAX(ua) AS ua, MAX(ref) AS ref,
    MAX(SUM(engaged)) OVER (PARTITION BY day, who) AS engaged
  FROM visits v WHERE day >= ? AND NOT EXISTS (SELECT 1 FROM visit_staff s WHERE s.day = v.day AND s.who = v.who) GROUP BY day, site, who, kind, via)`;
const n = (x: unknown) => Number(x ?? 0);

/** Everything the Visitors tab shows, over the last `days` days (1 to 30). */
export async function visitorsOf(conf: Env, days = 7): Promise<Visitors> {
  const now = Date.now(), span = Math.min(KEEP_DAYS, Math.max(1, Math.floor(days) || 7)), from = dayOf(now) - (span - 1) * DAY;
  const all = async <T>(sql: string, ...args: unknown[]) => (await conf.DB.prepare(sql).bind(...args).all<T>()).results;
  type Split = { real: number; browsers: number; agents: number; bots: number };
  const t0 = Date.now();
  const [totals] = await all<Split & { hits: number }>(`SELECT ${SPLIT}, SUM(hits) AS hits FROM ${FOLDED}`, from);
  const db_ms = Date.now() - t0;
  const sites = await all<Split & { site: string; hits: number }>(`SELECT site, ${SPLIT}, SUM(hits) AS hits FROM ${FOLDED} GROUP BY site ORDER BY real DESC, browsers DESC, hits DESC`, from);
  const byDay = await all<Split & { day: number }>(`SELECT day, ${SPLIT} FROM ${FOLDED} GROUP BY day ORDER BY day`, from);
  const refs = await all<{ ref: string; real: number }>(`SELECT ref, COUNT(DISTINCT who) AS real FROM ${FOLDED} WHERE ref IS NOT NULL AND kind = 'person' AND engaged > 0 GROUP BY ref ORDER BY real DESC LIMIT 12`, from);
  const recent = await all<Caller>(`SELECT who, site, kind, via, hits, engaged, last_at, ua, ref FROM ${FOLDED} WHERE last_at >= ? ORDER BY last_at DESC LIMIT 40`, from, now - DAY);
  const health = await conf.DB.prepare(`SELECT SUM(hits) AS hits, SUM(errors) AS errors FROM visits WHERE last_at >= ?`).bind(now - DAY).first<{ hits: number; errors: number }>();
  const signups = await conf.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE created_at >= ?").bind(from).first<number>("n");
  const split = (r: Partial<Split> | undefined) => ({ real: n(r?.real), browsers: n(r?.browsers), agents: n(r?.agents), bots: n(r?.bots) });
  // Every day in the range, an empty one too, so the bars keep their places.
  const by_day = Array.from({ length: span }, (_, i) => from + i * DAY).map((day) => ({ day, ...split(byDay.find((r) => n(r.day) === day)) }));
  return {
    generated_at: now, days: span, from,
    totals: { ...split(totals), hits: n(totals?.hits) },
    sites: sites.map((s) => ({ site: s.site, name: s.site === HOME ? "eqosys" : ourApp(s.site)?.name ?? s.site, ...split(s), hits: n(s.hits) })),
    by_day, refs: refs.map((r) => ({ ref: r.ref, real: n(r.real) })),
    recent: recent.map((c) => ({ ...c, hits: n(c.hits), engaged: n(c.engaged), last_at: n(c.last_at) })),
    signups: n(signups),
    health: { db_ms, hits: n(health?.hits), errors: n(health?.errors) },
  };
}
