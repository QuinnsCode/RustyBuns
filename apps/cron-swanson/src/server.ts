// The API: list, make, change, pause, run and delete jobs, and match an app's jobs to its own list. Every route but
// /api/health wants `Authorization: Bearer <...>`: the owner's eqosys token (the page, signed in) or CRON_SWANSON_TOKEN
// (scripts and apps: sync.ts). With neither set, it's open (a laptop, a test).
import { Bad, type Guard } from "@rustybuns/util/guard";
import { parseJson, privateJson } from "@rustybuns/util/http";
import type { Claims } from "@rustybuns/util/token";
import { next } from "./bacron.ts";
import { AppJobs, AppName, Declared, JobInput, NOT_OWNER, SIGN_IN, type Job, type JobsReply, type SyncReply } from "./api.ts";
import { fire, deliver, type Deliver } from "./ticker.ts";
import type { Store } from "./store.ts";
import { sameToken, ticket } from "./live.ts";

const MAX_BODY = 64 * 1024;

/** Who may use the page: the one eqosys account with this email (CRON_SWANSON_OWNER), its token checked by `checker` (a TokenChecker). */
export interface Owner { email: string; checker: { check(token: string): Promise<Claims | null> } }

export interface Options {
  /** The bearer for machine callers (CRON_SWANSON_TOKEN), and the secret the relay's tickets are signed with. */
  token?: string;
  owner?: Owner;
  send?: Deliver; now?: () => number;
  /** The relay's socket URL the page should hold (wss://.../live), or none to poll each minute. */
  live?: string;
  /** Called after anything a page shows changed: the nudge to the relay. */
  changed?: () => void;
}

const refuse = (error: string, status: number) => privateJson({ error }, status);

/** Why `req` may not in, or null when it may: the machine token, or an eqosys token for the owner's account. */
async function door(req: Request, o: Options): Promise<string | null> {
  if (!o.token && !o.owner) return null;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!given) return SIGN_IN;
  if (o.token && sameToken(given, o.token)) return null;
  const who = o.owner ? await o.owner.checker.check(given) : null;
  if (!who) return SIGN_IN;
  return who.email.toLowerCase() === o.owner!.email.toLowerCase() ? null : NOT_OWNER;
}

async function body<T>(req: Request, guard: Guard<T>): Promise<T | Response> {
  const text = await req.text();
  if (text.length > MAX_BODY) return refuse("too big", 413);
  try { return guard(parseJson(text)); } catch (e) {
    if (e instanceof Bad) return refuse(e.message, 400);
    throw e;
  }
}

/** A job's next run from `now`, or none while it's paused. */
const plan = (job: Job, now: number): Job => ({ ...job, nextAt: job.enabled ? next(job.cadence, now, job.tz, job.anchor) : null });

const APP = /^\/api\/apps\/([^/]{1,120})\/jobs$/;

const same = (a: Declared, b: Declared) => JSON.stringify(Declared(a)) === JSON.stringify(Declared(b));

/**
 * Makes the app's listed jobs match `list`: a new key is added, a changed one updated (a new cadence restarts its
 * "every" count; a pause made on the page stays), a key that's gone is deleted with its runs. Hand-made jobs stay.
 */
function sync(store: Store, app: string, list: Declared[], t: number): SyncReply {
  const reply: SyncReply = { added: [], changed: [], removed: [], same: 0 };
  const had = new Map(store.jobs().filter((j) => j.app === app && j.key).map((j) => [j.key, j]));
  for (const d of list) {
    const old = had.get(d.key);
    had.delete(d.key);
    if (!old) {
      store.put(plan({ ...d, app, enabled: true, id: crypto.randomUUID(), createdAt: t, updatedAt: t, anchor: t, nextAt: null }, t));
      reply.added.push(d.name);
    } else if (same(old, d)) reply.same++;
    else {
      const anchor = JSON.stringify(old.cadence) === JSON.stringify(d.cadence) ? old.anchor : t;
      store.put(plan({ ...old, ...d, anchor, updatedAt: t }, t));
      reply.changed.push(d.name);
    }
  }
  for (const gone of had.values()) {
    store.remove(gone.id);
    reply.removed.push(gone.name);
  }
  return reply;
}

export function api(store: Store, o: Options = {}): (req: Request) => Promise<Response> {
  const now = o.now ?? Date.now, send = o.send ?? deliver;
  const handle = route(store, o, now, send);
  return async (req) => {
    const res = await handle(req);
    if (req.method !== "GET" && res.ok) o.changed?.();
    return res;
  };
}

function route(store: Store, o: Options, now: () => number, send: Deliver): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url), path = url.pathname;
    if (path === "/api/health") return privateJson({ ok: true, now: now() });
    if (!path.startsWith("/api/")) return refuse("not found", 404);
    const shut = await door(req, o);
    if (shut) return refuse(shut, 401);

    if (path === "/api/jobs" && req.method === "GET") {
      const last = store.lastRuns(), stats = store.stats(now());
      const none = { fired: 0, done: 0, ignored: 0, lastDoneAt: null, lastFiredAt: null };
      const reply: JobsReply = { jobs: store.jobs().map((job) => ({ job, last: last.get(job.id) ?? null, stats: stats.get(job.id) ?? none })), runs: store.runs(100), now: now(), live: o.live ?? null, ticket: o.live && o.token ? await ticket(o.token, now()) : null };
      return privateJson(reply);
    }
    if (path === "/api/jobs" && req.method === "POST") {
      const input = await body(req, JobInput);
      if (input instanceof Response) return input;
      const t = now();
      const job = plan({ ...input, id: crypto.randomUUID(), key: "", createdAt: t, updatedAt: t, anchor: t, nextAt: null }, t);
      store.put(job);
      return privateJson(job, 201);
    }

    const tick = /^\/api\/runs\/(\d{1,15})\/done$/.exec(path);
    if (tick && req.method === "POST") {
      const run = store.done(Number(tick[1]), now());
      return run ? privateJson(run) : refuse("no such run", 404);
    }

    const own = APP.exec(path);
    if (own && req.method === "PUT") {
      let app = "";
      try { app = AppName(decodeURIComponent(own[1]!)); } catch { return refuse("app: a name up to 40 characters", 400); }
      const input = await body(req, AppJobs);
      if (input instanceof Response) return input;
      if (new Set(input.jobs.map((d) => d.key)).size < input.jobs.length) return refuse("jobs: each key once", 400);
      return privateJson(sync(store, app, input.jobs, now()));
    }

    const m = /^\/api\/jobs\/([\w-]{1,40})(\/run|\/runs)?$/.exec(path);
    const job = m ? store.job(m[1]!) : null;
    if (!m || !job) return refuse("no such job", 404);
    if (m[2] === "/runs" && req.method === "GET") return privateJson({ runs: store.runs(Math.min(200, Number(url.searchParams.get("limit")) || 50), job.id) });
    if (m[2] === "/run" && req.method === "POST") {
      if (job.action.kind === "elsewhere") return refuse(`${job.action.by} runs this one, not Cron Swanson`, 409);
      const t = now();
      return privateJson(await fire(store, job, t, t, send, true));
    }
    if (m[2]) return refuse("not found", 404);
    if (req.method === "PUT") {
      const input = await body(req, JobInput);
      if (input instanceof Response) return input;
      const t = now();
      // A new cadence starts its "every" count again; a rename or a pause doesn't.
      const anchor = JSON.stringify(input.cadence) === JSON.stringify(job.cadence) ? job.anchor : t;
      const changed = plan({ ...job, ...input, anchor, updatedAt: t }, t);
      store.put(changed);
      return privateJson(changed);
    }
    if (req.method === "DELETE") {
      store.remove(job.id);
      return privateJson({ ok: true });
    }
    return refuse("not found", 404);
  };
}
