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
//   GET    /api/orgs/:org/scripts/:id             (seasonal+)   PUT   …/scripts/:id {name?, body?, enabled?, cron?} (manager+)
//   DELETE /api/orgs/:org/scripts/:id             (owner+, soft)
//   POST   /api/orgs/:org/scripts/:id/run {input?} (employee+)  → the run row
//   GET    /api/orgs/:org/scripts/:id/runs        (seasonal+)   the last 50
//   POST   /api/orgs/:org/scripts/examples        (manager+)    install the three examples
//   GET    /api/orgs/:org/scripts/limits          (seasonal+)   PUT   …/scripts/limits {runs_per_day} (owner+)
//
// Every run counts against the org's limits (LIMITS, below), scheduled ones too: past one, the run
// route answers 429 and the hourly cron skips the script. A script with cron "0 * * * *" (hourly is
// the only schedule) runs from hourly() as the person who made it, with their role in the org now.

import { b64url, error, json, parseJson, readBody, sha256, type Env, type Row } from "./env.ts";
import type { Ctx } from "./orgs.ts";
import { rank, type Role } from "./rbac.ts";
import { EXAMPLES } from "./script-examples.ts";

const MAX_CALLS = 200;
const RUN_MS = 10_000;
const MAX_BODY = 64_000;
const MAX_LOG = 16_000;
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
function fetcher(env: Env, c: Caller, dispatch: (r: Request) => Promise<Response>, Base: new () => object = Object) {
  let calls = 0;
  // On the edge the binding must be an RpcTarget: a plain object holding a function is not a
  // documented env value for a dynamic Worker. Locally (no cloudflare:workers) a plain base does.
  return new (class extends Base {
    calls = () => calls;
    async call(method: string, path: string, body: string | null) {
      if (++calls > MAX_CALLS) return { status: 429, text: JSON.stringify({ error: `a run makes at most ${MAX_CALLS} calls` }) };
      const url = new URL(`${c.origin}/api/orgs/${c.org}${path}`);
      const first = url.pathname.split("/")[4] ?? "";
      if (!url.pathname.startsWith(`/api/orgs/${c.org}/`) || !REACHABLE.has(first)) return { status: 403, text: JSON.stringify({ error: "scripts reach contacts, companies, deals, activities and insights" }) };
      const res = await dispatch(new Request(url, { method, headers: { ...c.headers, ...(body !== null && { "content-type": "application/json" }) }, ...(body !== null && method !== "GET" && { body }) }));
      return { status: res.status, text: await res.text() };
    }
  })() as { calls(): number; call(method: string, path: string, body: string | null): Promise<{ status: number; text: string }> };
}

/** RpcTarget where the runtime has it (the edge); undefined under Bun, where an object is enough. */
const rpcBase = import("cloudflare:workers").then((m) => (m as unknown as { RpcTarget: new () => object }).RpcTarget, () => undefined);

const shown = (s: Row) => ({ ...s, enabled: !!s.enabled });
const COLS = "id, org_id, name, body, lang, created_by, created_at, updated_at, enabled, cron";
const scriptRow = (env: Env, org: string, id: string) =>
  env.DB.prepare(`SELECT ${COLS} FROM scripts WHERE org_id = ? AND id = ? AND deleted_at IS NULL`).bind(org, id).first();

/** The one schedule: on the hour, when the cron fires. "@hourly" is the same thing. */
export const HOURLY = "0 * * * *";
const DAY = 86_400_000;

/**
 * The org's run limits, a stack checked in order like codeSplitter's rate-limit rules: each counts
 * the org's runs in its window (script_runs is the counter) against its cap, and the first one over
 * says why. A new limit (per person, per role) is one more row.
 */
const LIMITS: { label: string; window: number; max: (org: Row) => number }[] = [
  { label: "runs a day", window: DAY, max: (o) => Number(o.script_runs_per_day) },
];

/** Why the org can't run another script now, or null. */
async function overLimit(env: Env, org: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT script_runs_per_day FROM orgs WHERE id = ?").bind(org).first();
  if (!row) return null;
  for (const l of LIMITS) {
    const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM script_runs WHERE org_id = ? AND started_at > ?").bind(org, Date.now() - l.window).first<number>("n")) ?? 0;
    const max = l.max(row);
    if (n >= max) return `this org's scripts are limited to ${max} ${l.label}; try again later`;
  }
  return null;
}

type Checked = { name?: string; body?: string; enabled?: number; cron?: string | null };
function checkScript(b: { name?: unknown; body?: unknown; enabled?: unknown; cron?: unknown } | null, partial: boolean): Checked | string {
  const out: Checked = {};
  if (b?.name !== undefined || !partial) { if (typeof b?.name !== "string" || !b.name.trim() || b.name.length > 120) return "name: up to 120 characters"; out.name = b.name.trim(); }
  if (b?.body !== undefined || !partial) { if (typeof b?.body !== "string" || b.body.length > MAX_BODY) return `body: JavaScript, up to ${MAX_BODY} characters`; out.body = b.body; }
  if (b?.enabled !== undefined) { if (typeof b.enabled !== "boolean") return "enabled: true or false"; out.enabled = b.enabled ? 1 : 0; }
  if (b?.cron !== undefined) {
    if (b.cron !== null && b.cron !== HOURLY && b.cron !== "@hourly") return `cron: "${HOURLY}" (hourly is the only schedule) or null`;
    out.cron = b.cron === null ? null : HOURLY;
  }
  return out;
}

export async function insert(env: Env, org: string, by: string, name: string, body: string, cron: string | null = null) {
  const now = Date.now();
  const s = { id: crypto.randomUUID(), org_id: org, name, body, lang: "js", created_by: by, created_at: now, updated_at: now, enabled: true, cron };
  await env.DB.prepare("INSERT INTO scripts (id, org_id, name, body, lang, created_by, created_at, updated_at, enabled, cron) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)").bind(s.id, org, name, body, "js", by, now, now, cron).run();
  return s;
}

/** Who a run acts as: their credentials for the calls back in, and their id for the run row. */
interface Runner extends Caller { user: string }

/** One run, recorded whatever happens. */
async function run(env: Env, c: Runner, script: Row, input: unknown, dispatch: (r: Request) => Promise<Response>) {
  const { origin } = c;
  const q = fetcher(env, c, dispatch, await rpcBase);
  const started = Date.now(), id = crypto.randomUUID();
  let status = "ok", log: string[] = [], result: unknown = null, timer: ReturnType<typeof setTimeout> | undefined;
  try {
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
    const m = String((e as Error)?.message ?? e);
    status = m === "timeout" ? "timeout" : "error";
    log.push(status === "timeout" ? `timeout: the run took more than ${RUN_MS / 1000} s` : `error: ${m}`);
  } finally { clearTimeout(timer); }
  let text = log.join("\n");
  if (text.length > MAX_LOG) text = text.slice(0, MAX_LOG - 20) + "\n… (log cut here)";
  const row = { id, org_id: c.org, script_id: script.id, actor_user_id: c.user, started_at: started, finished_at: Date.now(), status, log: text, result, calls: q.calls() };
  await env.DB.prepare("INSERT INTO script_runs (id, org_id, script_id, actor_user_id, started_at, finished_at, status, log, result, calls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, c.org, script.id, c.user, started, row.finished_at, status, text, JSON.stringify(result ?? null), row.calls).run();
  return row;
}

const atLeast = (role: Role, need: Role) => rank(role) >= rank(need);

/**
 * The hourly cron's part: each enabled script with a schedule runs once, as its maker, while they
 * are still an employee or more in the org and the org is under its limits. The calls back in go
 * on a key that lives for the run (hidden from the keys list by its grant_id) and is then deleted.
 */
export async function runScheduled(env: Env): Promise<number> {
  if (!env.LOADER) return 0;
  const { handleApi } = await import("./api.ts");
  const { results } = await env.DB.prepare(`SELECT s.${COLS.split(", ").join(", s.")}, m.role FROM scripts s JOIN memberships m ON m.org_id = s.org_id AND m.user_id = s.created_by
    WHERE s.cron IS NOT NULL AND s.enabled = 1 AND s.deleted_at IS NULL LIMIT 500`).all();
  const origin = env.BETTER_AUTH_URL ?? "http://localhost";
  let ran = 0;
  for (const s of results) {
    const org = String(s.org_id), user = String(s.created_by);
    if (!atLeast(s.role as Role, "employee") || await overLimit(env, org)) continue;
    const secret = "qo_" + b64url(crypto.getRandomValues(new Uint8Array(24))), keyId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO api_keys (id, org_id, user_id, name, hash, prefix, created_at, expires_at, grant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(keyId, org, user, `scheduled: ${s.name}`, await sha256(secret), secret.slice(0, 8), Date.now(), Date.now() + RUN_MS + 30_000, `script:${s.id}`).run();
    try { await run(env, { headers: { authorization: `Bearer ${secret}` }, org, origin, user }, s, { scheduled: true }, (r) => handleApi(r, env)); ran++; }
    finally { await env.DB.prepare("DELETE FROM api_keys WHERE id = ?").bind(keyId).run(); }
  }
  return ran;
}

export async function scriptRoutes(c: Ctx, dispatch: (r: Request) => Promise<Response>): Promise<Response | null> {
  const { req, env, org, role, user, p } = c;
  if (p[0] !== "scripts") return null;
  if (!env.LOADER) return error(503, "scripts off");
  if (!p[1] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, name, lang, created_by, created_at, updated_at, enabled, cron FROM scripts WHERE org_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200").bind(org).all();
    return json(results.map(shown));
  }
  if (!p[1] && req.method === "POST") {
    if (!atLeast(role, "manager")) return error(403, "managers and up write scripts");
    const v = checkScript(await readBody(req), false);
    if (typeof v === "string") return error(400, v);
    const s = await insert(env, org, user.id, v.name!, v.body!, v.cron ?? null);
    await c.audit("script.create", s.id, s.name);
    return json(s, 201);
  }
  if (p[1] === "limits" && !p[2]) {
    if (req.method === "PUT") {
      if (!atLeast(role, "owner")) return error(403, "owners and up set script limits");
      const n = (await readBody<{ runs_per_day?: unknown }>(req))?.runs_per_day;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 100_000) return error(400, "runs_per_day: a whole number, 0 to 100000");
      await env.DB.prepare("UPDATE orgs SET script_runs_per_day = ? WHERE id = ?").bind(n, org).run();
      await c.audit("script.limits", null, { runs_per_day: n });
    } else if (req.method !== "GET") return null;
    const max = await env.DB.prepare("SELECT script_runs_per_day FROM orgs WHERE id = ?").bind(org).first<number>("script_runs_per_day");
    const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM script_runs WHERE org_id = ? AND started_at > ?").bind(org, Date.now() - DAY).first<number>("n");
    return json({ runs_per_day: max, runs_last_day: used ?? 0 });
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
    const next = { ...script, ...v, updated_at: Date.now() };
    await env.DB.prepare("UPDATE scripts SET name = ?, body = ?, enabled = ?, cron = ?, updated_at = ? WHERE id = ?").bind(next.name, next.body, next.enabled ? 1 : 0, next.cron ?? null, next.updated_at, script.id).run();
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
    const over = await overLimit(env, org);
    if (over) return error(429, over);
    const b = await readBody<{ input?: unknown }>(req);
    const origin = env.BETTER_AUTH_URL ?? c.url.origin;
    const auth = req.headers.get("authorization");
    const headers: Record<string, string> = auth ? { authorization: auth } : { cookie: req.headers.get("cookie") ?? "", origin };
    return json(await run(env, { headers, org, origin, user: user.id }, script, b?.input, dispatch), 201);
  }
  if (p[2] === "runs" && !p[3] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, actor_user_id, started_at, finished_at, status, log, result, calls FROM script_runs WHERE org_id = ? AND script_id = ? ORDER BY started_at DESC LIMIT 50").bind(org, script.id).all();
    return json(results.map((r) => ({ ...r, result: parseJson(r.result, null) })));
  }
  return null;
}
