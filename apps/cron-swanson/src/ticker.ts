// The ticker: wakes a quarter second after each minute starts, fires every job that's due, and books its next
// run before the first webhook is sent, so a slow URL can't make it fire twice. A job that was due while the
// box was down fires once when it's back (its drift says how late) and then goes on from now.
import { next } from "./bacron.ts";
import type { Job, Run } from "./api.ts";
import type { Store } from "./store.ts";

export const MINUTE = 60_000;
const SETTLE_MS = 250;
const WEBHOOK_TIMEOUT_MS = 15_000;

export type Outcome = Pick<Run, "status" | "code" | "ms" | "error">;
export type Deliver = (job: Job, scheduledAt: number, firedAt: number) => Promise<Outcome>;

/** Where reminders ping the phone: an ntfy topic URL (`https://ntfy.sh/<topic>` or a server of your own), and its token if it wants one. */
export interface Ntfy { url: string; token?: string }

/** Sends one request and says how it went: the code, how long it took, or what broke. */
async function call(url: string | URL, init: RequestInit, ok: Outcome["status"]): Promise<Outcome> {
  const started = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS), redirect: "follow" });
    await res.body?.cancel();
    const ms = Math.round(performance.now() - started);
    return { status: res.ok ? ok : "failed", code: res.status, ms, error: res.ok ? "" : (res.statusText || "refused").slice(0, 500) };
  } catch (e) {
    return { status: "failed", code: null, ms: Math.round(performance.now() - started), error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
  }
}

/** A reminder on the phone: ntfy's JSON publish (to the server's root, naming the topic) so any text in a name gets through. */
async function ping(ntfy: Ntfy, job: Job): Promise<Outcome> {
  const root = new URL(ntfy.url), parts = root.pathname.split("/").filter(Boolean);
  const topic = parts.pop() ?? "";
  root.pathname = `/${parts.join("/")}`;
  const out = await call(root, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "cron-swanson", ...(ntfy.token ? { authorization: `Bearer ${ntfy.token}` } : {}) },
    body: JSON.stringify({ topic, title: `${job.app}: ${job.name}`, message: job.why || job.note || job.name, tags: ["alarm_clock", ...job.tags.slice(0, 4)] }),
  }, "reminded");
  return out.status === "failed" ? { ...out, error: `phone ping: ${out.error}`.slice(0, 500) } : out;
}

/** What firing does: a reminder pings the phone (with `ntfy` set and the job's ping on) or just shows in the feed; a webhook calls its URL. */
export function delivery(ntfy?: Ntfy): Deliver {
  return async (job, scheduledAt, firedAt) => {
    if (job.action.kind === "remind") {
      return ntfy && job.action.ping ? ping(ntfy, job) : { status: "reminded", code: null, ms: null, error: "" };
    }
    const { url, method } = job.action;
    return call(url, {
      method,
      headers: method === "POST" ? { "content-type": "application/json", "user-agent": "cron-swanson" } : { "user-agent": "cron-swanson" },
      body: method === "POST" ? JSON.stringify({ job: job.id, app: job.app, name: job.name, tags: job.tags, scheduledAt, firedAt }) : undefined,
    }, "ok");
  };
}

/** Reminders that only show in the feed, and webhooks. */
export const deliver: Deliver = delivery();

/** Fires one job now and logs the run. */
export async function fire(store: Store, job: Job, scheduledAt: number, firedAt: number, send: Deliver, manual = false): Promise<Run> {
  const out = await send(job, scheduledAt, firedAt);
  return store.addRun({ jobId: job.id, scheduledAt, firedAt, manual, ...out });
}

/** One minute's work: every due job booked forward, then fired. Resolves when every delivery has. */
export function tick(store: Store, now: number, send: Deliver = deliver): Promise<Run[]> {
  const due = store.due(now);
  for (const job of due) store.put({ ...job, nextAt: next(job.cadence, now, job.tz, job.anchor) });
  return Promise.all(due.map((job) => fire(store, job, job.nextAt!, now, send)));
}

/** Ticks now (to catch up) and then on every minute until stopped. */
export function startTicker(store: Store, send: Deliver = deliver, log: (e: unknown) => void = console.error): { stop(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const beat = () => { tick(store, Date.now(), send).catch(log); };
  const loop = () => {
    const wait = MINUTE - (Date.now() % MINUTE) + SETTLE_MS;
    timer = setTimeout(() => { beat(); loop(); }, wait);
  };
  beat();
  loop();
  return { stop: () => clearTimeout(timer) };
}
