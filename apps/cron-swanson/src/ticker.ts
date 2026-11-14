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

/** Calls the job's URL (or does nothing for a reminder) and says how it went. */
export const deliver: Deliver = async (job, scheduledAt, firedAt) => {
  if (job.action.kind === "remind") return { status: "reminded", code: null, ms: null, error: "" };
  const started = performance.now();
  const { url, method } = job.action;
  try {
    const res = await fetch(url, {
      method,
      headers: method === "POST" ? { "content-type": "application/json", "user-agent": "cron-swanson" } : { "user-agent": "cron-swanson" },
      body: method === "POST" ? JSON.stringify({ job: job.id, app: job.app, name: job.name, tags: job.tags, scheduledAt, firedAt }) : undefined,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      redirect: "follow",
    });
    await res.body?.cancel();
    const ms = Math.round(performance.now() - started);
    return { status: res.ok ? "ok" : "failed", code: res.status, ms, error: res.ok ? "" : res.statusText.slice(0, 500) };
  } catch (e) {
    return { status: "failed", code: null, ms: Math.round(performance.now() - started), error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
  }
};

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
