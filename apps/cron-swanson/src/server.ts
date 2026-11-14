// The API: list, make, change, pause, run and delete jobs. With CRON_SWANSON_TOKEN set, every route but
// /api/health wants `Authorization: Bearer <token>`; unset, it's open (a laptop, a test).
import { Bad, type Guard } from "@rustybuns/util/guard";
import { parseJson, privateJson } from "@rustybuns/util/http";
import { next } from "./bacron.ts";
import { JobInput, type Job, type JobsReply } from "./api.ts";
import { fire, deliver, type Deliver } from "./ticker.ts";
import type { Store } from "./store.ts";

const MAX_BODY = 64 * 1024;

export interface Options { token?: string; send?: Deliver; now?: () => number }

const refuse = (error: string, status: number) => privateJson({ error }, status);

function sameToken(given: string, want: string): boolean {
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(want);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]!;
  return diff === 0;
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

export function api(store: Store, o: Options = {}): (req: Request) => Promise<Response> {
  const now = o.now ?? Date.now, send = o.send ?? deliver;
  return async (req) => {
    const url = new URL(req.url), path = url.pathname;
    if (path === "/api/health") return privateJson({ ok: true, now: now() });
    if (!path.startsWith("/api/")) return refuse("not found", 404);
    if (o.token && !sameToken(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", o.token)) return refuse("token needed", 401);

    if (path === "/api/jobs" && req.method === "GET") {
      const last = store.lastRuns();
      const reply: JobsReply = { jobs: store.jobs().map((job) => ({ job, last: last.get(job.id) ?? null })), runs: store.runs(100), now: now() };
      return privateJson(reply);
    }
    if (path === "/api/jobs" && req.method === "POST") {
      const input = await body(req, JobInput);
      if (input instanceof Response) return input;
      const t = now();
      const job = plan({ ...input, id: crypto.randomUUID(), createdAt: t, updatedAt: t, anchor: t, nextAt: null }, t);
      store.put(job);
      return privateJson(job, 201);
    }

    const m = /^\/api\/jobs\/([\w-]{1,40})(\/run|\/runs)?$/.exec(path);
    const job = m ? store.job(m[1]!) : null;
    if (!m || !job) return refuse("no such job", 404);
    if (m[2] === "/runs" && req.method === "GET") return privateJson({ runs: store.runs(Math.min(200, Number(url.searchParams.get("limit")) || 50), job.id) });
    if (m[2] === "/run" && req.method === "POST") {
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
