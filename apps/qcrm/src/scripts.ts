// Scripts: small programs an org keeps and runs, by hand, from the API, or from an agent through
// MCP. A run is a Cloudflare dynamic Worker (env.LOADER, the worker_loader binding) with no
// network (`globalOutbound: null`) and one binding, QCRM: a fetcher we make in-process that
// calls back into this API as the person who pressed run, in their org, with their role. The
// script never sees their cookie or key, only answers. A run may make 200 calls and take 10 s.
//
// A script body is the inside of `async ({ input, qcrm, log }) => { … }`, where
//   qcrm.list(entity, params?)   qcrm.get(entity, id)   qcrm.create(entity, data)
//   qcrm.update(entity, id, data)   qcrm.remove(entity, id)   qcrm.insights()
// each is one HTTP call (entity: contacts, companies, deals, activities), and log(...) adds a line.
// What the body returns is the run's result.
//
//   GET    /api/orgs/:org/scripts                 (seasonal+)   POST  …/scripts {name, body}       (manager+)
//   GET    /api/orgs/:org/scripts/:id             (seasonal+)   PUT   …/scripts/:id {name?, body?, enabled?} (manager+)
//   DELETE /api/orgs/:org/scripts/:id             (owner+, soft)
//   POST   /api/orgs/:org/scripts/:id/run {input?} (employee+)  → the run row
//   GET    /api/orgs/:org/scripts/:id/runs        (seasonal+)   the last 50
//   POST   /api/orgs/:org/scripts/examples        (manager+)    install the three examples
//
// A script may carry a schedule, "hourly" or "daily" (set in the same POST and PUT, manager+, null clears
// it). The hourly cron (runDue) runs the due ones as run_as, the manager who last set the schedule or
// the body, with their role in the org at that moment; if they have left, the run is recorded as skipped.
// Every run, by hand or scheduled, first passes the stacked quota policies in script-limits.ts.

import { grantRun, type User } from "./auth.ts";
import { error, json, parseJson, readBody, type Env, type Row } from "./env.ts";
import type { Ctx } from "./orgs.ts";
import { describe, overQuota } from "./script-limits.ts";
import { rank, type Role } from "./rbac.ts";
import { memberOf } from "./orgs.ts";
import { EXAMPLES } from "./script-examples.ts";

const MAX_CALLS = 200;
const RUN_MS = 10_000;
const MAX_BODY = 64_000;
const MAX_LOG = 16_000;
const SCHEDULES = { hourly: 50 * 60_000, daily: 23 * 3_600_000 } as const;
type Schedule = keyof typeof SCHEDULES;
/** Scripts one cron tick starts at most; the rest wait for the next hour. */
const MAX_DUE = 50;
/** What a script may call back into: CRM rows and the numbers. Not members, keys, webhooks or other scripts. */
const REACHABLE = new Set(["contacts", "companies", "deals", "activities", "insights"]);

/** The dynamic Worker's module: the user's body inside a fetch handler, with the client over env.QCRM. */
const wrap = (body: string) => `
const call = async (env, method, path, data) => {
  const r = await env.QCRM.call(method, path, data === undefined ? null : JSON.stringify(data));
  const v = r.text ? JSON.parse(r.text) : null;
  if (r.status >= 300) throw new Error((v && v.error) || ("qcrm " + method + " " + path + ": " + r.status));
  return v;
};
const client = (env) => ({
  list: (entity, params) => call(env, "GET", "/" + entity + (params ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) : "")),
  get: (entity, id) => call(env, "GET", "/" + entity + "/" + encodeURIComponent(id)),
  create: (entity, data) => call(env, "POST", "/" + entity, data),
  update: (entity, id, data) => call(env, "PUT", "/" + entity + "/" + encodeURIComponent(id), data),
  remove: (entity, id) => call(env, "DELETE", "/" + entity + "/" + encodeURIComponent(id)),
  insights: () => call(env, "GET", "/insights"),
});
const script = async ({ input, qcrm, log }) => {
${body}
};
export default {
  async fetch(req, env) {
    const input = await req.json();
    const log = [];
    try {
      const result = await script({ input, qcrm: client(env), log: (...a) => { log.push(a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ")); } });
      return Response.json({ ok: true, result: result === undefined ? null : result, log });
    } catch (e) {
      return Response.json({ ok: false, error: String(e && e.message || e), log });
    }
  },
};
`;

interface Caller { headers: Record<string, string>; org: string; origin: string }

/**
 * The QCRM binding: every call is an HTTP request back into this app as the caller. Only plain
 * values cross (method, path, text), so it works the same as an RPC stub on the edge and as an
 * object in the local twin.
 */
function fetcher(env: Env, c: Caller, dispatch: (r: Request) => Promise<Response>) {
  let calls = 0;
  return {
    calls: () => calls,
    async call(method: string, path: string, body: string | null) {
      if (++calls > MAX_CALLS) return { status: 429, text: JSON.stringify({ error: `a run makes at most ${MAX_CALLS} calls` }) };
      const url = new URL(`${c.origin}/api/orgs/${c.org}${path}`);
      const first = url.pathname.split("/")[4] ?? "";
      if (!url.pathname.startsWith(`/api/orgs/${c.org}/`) || !REACHABLE.has(first)) return { status: 403, text: JSON.stringify({ error: "scripts reach contacts, companies, deals, activities and insights" }) };
      const res = await dispatch(new Request(url, { method, headers: { ...c.headers, ...(body !== null && { "content-type": "application/json" }) }, ...(body !== null && method !== "GET" && { body }) }));
      return { status: res.status, text: await res.text() };
    },
  };
}

const shown = (s: Row) => ({ ...s, enabled: !!s.enabled });
const scriptRow = (env: Env, org: string, id: string) =>
  env.DB.prepare("SELECT id, org_id, name, body, lang, created_by, created_at, updated_at, enabled, schedule, run_as, last_scheduled_at FROM scripts WHERE org_id = ? AND id = ? AND deleted_at IS NULL").bind(org, id).first();

function checkScript(b: { name?: unknown; body?: unknown; enabled?: unknown; schedule?: unknown } | null, partial: boolean): { name?: string; body?: string; enabled?: number; schedule?: Schedule | null } | string {
  const out: { name?: string; body?: string; enabled?: number; schedule?: Schedule | null } = {};
  if (b?.name !== undefined || !partial) { if (typeof b?.name !== "string" || !b.name.trim() || b.name.length > 120) return "name: up to 120 characters"; out.name = b.name.trim(); }
  if (b?.body !== undefined || !partial) { if (typeof b?.body !== "string" || b.body.length > MAX_BODY) return `body: JavaScript, up to ${MAX_BODY} characters`; out.body = b.body; }
  if (b?.enabled !== undefined) { if (typeof b.enabled !== "boolean") return "enabled: true or false"; out.enabled = b.enabled ? 1 : 0; }
  if (b?.schedule !== undefined) { if (b.schedule !== null && !(typeof b.schedule === "string" && b.schedule in SCHEDULES)) return 'schedule: "hourly", "daily" or null'; out.schedule = b.schedule as Schedule | null; }
  return out;
}

async function insert(env: Env, org: string, by: string, name: string, body: string, schedule: Schedule | null = null) {
  const now = Date.now();
  const s = { id: crypto.randomUUID(), org_id: org, name, body, lang: "js", created_by: by, created_at: now, updated_at: now, enabled: true, schedule, run_as: schedule ? by : null };
  await env.DB.prepare("INSERT INTO scripts (id, org_id, name, body, lang, created_by, created_at, updated_at, enabled, schedule, run_as) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)").bind(s.id, org, name, body, "js", by, now, now, schedule, s.run_as).run();
  return s;
}

/** Who a run acts as: the headers its calls carry back into the API. */
interface Who { actor: string; org: string; origin: string; headers: Record<string, string>; trigger: "manual" | "schedule" }

/** One run, recorded whatever happens. */
async function run(env: Env, who: Who, script: Row, input: unknown, dispatch: (r: Request) => Promise<Response>, outcome?: { status: string; log: string }) {
  const { origin } = who;
  const q = fetcher(env, { headers: who.headers, org: who.org, origin }, dispatch);
  const started = Date.now(), id = crypto.randomUUID();
  let status = "ok", log: string[] = [], result: unknown = null, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (outcome) throw Object.assign(new Error(outcome.log), { skip: outcome.status });
    // The id carries updated_at: an edited script is a fresh Worker, an unchanged one is reused.
    const stub = env.LOADER!.get(`${script.id}:${script.updated_at}`, () => ({
      compatibilityDate: "2026-09-01", mainModule: "script.js", modules: { "script.js": wrap(script.body as string) }, env: { QCRM: q }, globalOutbound: null,
    })).getEntrypoint();
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), RUN_MS); });
    const res = await Promise.race([stub.fetch(`${origin}/run`, { method: "POST", body: JSON.stringify(input ?? null), headers: { "content-type": "application/json" } }), timeout]);
    const out = (await res.json()) as { ok: boolean; result?: unknown; error?: string; log: string[] };
    log = Array.isArray(out.log) ? out.log : [];
    if (out.ok) result = out.result;
    else { status = "error"; log.push(`error: ${out.error}`); }
  } catch (e) {
    const m = String((e as Error)?.message ?? e), skip = (e as { skip?: string }).skip;
    status = skip ?? (m === "timeout" ? "timeout" : "error");
    log.push(skip ? `${skip}: ${m}` : status === "timeout" ? `timeout: the run took more than ${RUN_MS / 1000} s` : `error: ${m}`);
  } finally { clearTimeout(timer); }
  let text = log.join("\n");
  if (text.length > MAX_LOG) text = text.slice(0, MAX_LOG - 20) + "\n… (log cut here)";
  const row = { id, org_id: who.org, script_id: script.id, actor_user_id: who.actor, started_at: started, finished_at: Date.now(), status, log: text, result, calls: q.calls(), trigger: who.trigger };
  await env.DB.prepare("INSERT INTO script_runs (id, org_id, script_id, actor_user_id, started_at, finished_at, status, log, result, calls, trigger) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, who.org, script.id, who.actor, started, row.finished_at, status, text, JSON.stringify(result ?? null), row.calls, who.trigger).run();
  return row;
}

const refusal = (q: NonNullable<Awaited<ReturnType<typeof overQuota>>>) =>
  json({ error: `over the script quota (${describe(q.policy)}): try again in ${Math.ceil(q.retry_ms / 60_000)} min`, policy: q.policy.name }, 429, { "retry-after": String(Math.ceil(q.retry_ms / 1000)) });

/**
 * The hourly cron's half: start every enabled script whose schedule has come round, as its run_as
 * person, one after another. A run the quota or a departed run_as stops is recorded as skipped.
 */
export async function runDue(env: Env, dispatch: (r: Request) => Promise<Response>, now = Date.now()): Promise<number> {
  if (!env.LOADER) return 0;
  const { results } = await env.DB.prepare("SELECT id, org_id, body, updated_at, schedule, run_as, last_scheduled_at FROM scripts WHERE schedule IS NOT NULL AND enabled = 1 AND deleted_at IS NULL ORDER BY last_scheduled_at LIMIT ?").bind(MAX_DUE * 4).all<Row>();
  let started = 0;
  for (const s of results) {
    if (started >= MAX_DUE) break;
    if (s.last_scheduled_at && now - (s.last_scheduled_at as number) < SCHEDULES[s.schedule as Schedule]) continue;
    started++;
    await env.DB.prepare("UPDATE scripts SET last_scheduled_at = ? WHERE id = ?").bind(now, s.id).run();
    const org = s.org_id as string, by = s.run_as as string;
    const role = await memberOf(env, org, by);
    const person = await env.DB.prepare('SELECT id, email, name FROM "user" WHERE id = ?').bind(by).first<User>();
    const base = { actor: by, org, origin: env.BETTER_AUTH_URL ?? "http://qcrm.internal", trigger: "schedule" as const };
    if (!role || !person) { await run(env, { ...base, headers: {} }, s, null, dispatch, { status: "skipped", log: "the person it runs as is no longer in the org" }); continue; }
    const over = await overQuota(env, org, by, role, now);
    if (over) { await run(env, { ...base, headers: {} }, s, null, dispatch, { status: "skipped", log: `over the script quota (${describe(over.policy)})` }); continue; }
    const grant = grantRun(person, org);
    try { await run(env, { ...base, headers: { authorization: `Bearer ${grant.token}` } }, s, null, dispatch); } finally { grant.revoke(); }
  }
  return started;
}

const atLeast = (role: Role, need: Role) => rank(role) >= rank(need);

export async function scriptRoutes(c: Ctx, dispatch: (r: Request) => Promise<Response>): Promise<Response | null> {
  const { req, env, org, role, user, p } = c;
  if (p[0] !== "scripts") return null;
  if (!env.LOADER) return error(503, "scripts off");
  if (!p[1] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, name, lang, created_by, created_at, updated_at, enabled, schedule FROM scripts WHERE org_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200").bind(org).all();
    return json(results.map(shown));
  }
  if (!p[1] && req.method === "POST") {
    if (!atLeast(role, "manager")) return error(403, "managers and up write scripts");
    const v = checkScript(await readBody(req), false);
    if (typeof v === "string") return error(400, v);
    const s = await insert(env, org, user.id, v.name!, v.body!, v.schedule ?? null);
    await c.audit("script.create", s.id, s.name);
    return json(s, 201);
  }
  if (p[1] === "examples" && !p[2] && req.method === "POST") {
    if (!atLeast(role, "manager")) return error(403, "managers and up write scripts");
    const made = [];
    for (const e of EXAMPLES) made.push(await insert(env, org, user.id, e.name, e.body));
    await c.audit("script.examples", null, made.length);
    return json(made, 201);
  }
  const script = p[1] ? await scriptRow(env, org, p[1]) : null;
  if (!script) return error(404, "no such script");
  if (!p[2] && req.method === "GET") return json(shown(script));
  if (!p[2] && req.method === "PUT") {
    if (!atLeast(role, "manager")) return error(403, "managers and up write scripts");
    const v = checkScript(await readBody(req), true);
    if (typeof v === "string") return error(400, v);
    const next: Row = { ...script, ...v, updated_at: Date.now() };
    // Whoever last sets the schedule or changes a scheduled body is who it runs as, so an edit never borrows a bigger role.
    if (next.schedule && (v.schedule !== undefined || v.body !== undefined)) next.run_as = user.id;
    if (!next.schedule) next.run_as = null;
    await env.DB.prepare("UPDATE scripts SET name = ?, body = ?, enabled = ?, schedule = ?, run_as = ?, updated_at = ? WHERE id = ?").bind(next.name, next.body, next.enabled ? 1 : 0, next.schedule ?? null, next.run_as ?? null, next.updated_at, script.id).run();
    await c.audit("script.update", script.id as string);
    return json(shown(next));
  }
  if (!p[2] && req.method === "DELETE") {
    if (!atLeast(role, "owner")) return error(403, "owners and up delete scripts");
    await env.DB.prepare("UPDATE scripts SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(Date.now(), Date.now(), script.id).run();
    await c.audit("script.delete", script.id as string);
    return json({ ok: true });
  }
  if (p[2] === "run" && !p[3] && req.method === "POST") {
    if (!atLeast(role, "employee")) return error(403, "employees and up run scripts");
    if (!script.enabled) return error(409, "this script is switched off");
    const over = await overQuota(env, org, user.id, role);
    if (over) return refusal(over);
    const b = await readBody<{ input?: unknown }>(req);
    const origin = env.BETTER_AUTH_URL ?? c.url.origin;
    const auth = req.headers.get("authorization"), cookie = req.headers.get("cookie");
    const headers: Record<string, string> = auth ? { authorization: auth } : { cookie: cookie ?? "", origin };
    return json(await run(env, { actor: user.id, org, origin, headers, trigger: "manual" }, script, b?.input, dispatch), 201);
  }
  if (p[2] === "runs" && !p[3] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, actor_user_id, started_at, finished_at, status, log, result, calls, trigger FROM script_runs WHERE org_id = ? AND script_id = ? ORDER BY started_at DESC LIMIT 50").bind(org, script.id).all();
    return json(results.map((r) => ({ ...r, result: parseJson(r.result, null) })));
  }
  return null;
}
