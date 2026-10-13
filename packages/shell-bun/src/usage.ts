// What a host's bindings did, counted per cause, so `rustybuns plan --usage` can turn a run of it
// into a monthly bill (#1224). The bill comes from the fan-out: one cron tick runs a dozen sweeps,
// each a few Durable Object calls, D1 rows and queue sends. Every unit of work runs inside a cause
// (a request, a cron's tick, a queue's message batch), carried by AsyncLocalStorage, so a DO RPC
// three awaits deep still counts toward the tick that started it. Timers inherit it too: an alarm
// set during a tick counts toward that tick. Work with no cause (a socket frame) lands in "other".
//
// Counts are keyed `<binding>.<unit>`: requests, objects (distinct DO ids a run touched) and busyMs
// for a DO; rowsRead/rowsWritten for D1; reads/writes/lists for KV; classA/classB for R2; sent for
// a queue. `/__rb/usage` serves the snapshot, and the desktop host writes it to <data>/usage.json.

import { AsyncLocalStorage } from "node:async_hooks";

export interface CauseUsage {
  /** Requests, ticks, or messages for a queue's consumer. */
  runs: number;
  /** Wall time from start until the handler settled: an upper bound on CPU time. */
  busyMs: number;
  ops: Record<string, number>;
}

export interface UsageSnapshot {
  /** When counting started (ms since epoch) and how long it has run. */
  since: number;
  uptimeS: number;
  /** Keyed "request", "cron <expr>", "queue <binding>", "other". */
  causes: Record<string, CauseUsage>;
}

interface Run { cause: string; seen: Set<string> }

const als = new AsyncLocalStorage<Run>();
let since = Date.now();
let causes: Record<string, CauseUsage> = {};

const slot = (cause: string) => (causes[cause] ??= { runs: 0, busyMs: 0, ops: {} });

/** Count `n` of `key` (`<binding>.<unit>`) toward whatever cause is running now. */
export function count(key: string, n = 1): void {
  if (!n) return;
  const ops = slot(als.getStore()?.cause ?? "other").ops;
  ops[key] = (ops[key] ?? 0) + n;
}

/** Count one `<binding>.objects` the first time this run touches DO `id`: the distinct objects a tick wakes. */
export function touch(binding: string, id: string): void {
  const run = als.getStore(), key = `${binding}:${id}`;
  if (run?.seen.has(key)) return;
  run?.seen.add(key);
  count(`${binding}.objects`);
}

/** Run `fn` as `runs` runs of `cause`; what its bindings do counts toward it. */
export function within<T>(cause: string, fn: () => T, runs = 1): T {
  const s = slot(cause), t0 = performance.now();
  s.runs += runs;
  const done = () => { s.busyMs += performance.now() - t0; };
  const out = als.run({ cause, seen: new Set() }, fn);
  if (out instanceof Promise) return out.finally(done) as T;
  done();
  return out;
}

export function usageSnapshot(): UsageSnapshot {
  const out: Record<string, CauseUsage> = {};
  for (const [k, v] of Object.entries(causes)) out[k] = { runs: v.runs, busyMs: Math.round(v.busyMs), ops: { ...v.ops } };
  return { since, uptimeS: Math.round((Date.now() - since) / 1000), causes: out };
}

/** Start counting again (tests, or a fresh measurement window). */
export function resetUsage(): void { since = Date.now(); causes = {}; }

type Units = Record<string, string | ((result: unknown, args: unknown[]) => [string, number] | undefined)>;

const rows = (r: unknown): number => Array.isArray(r) ? r.length : r == null ? 0 : 1;
const d1Meta = (r: unknown): [string, number][] => {
  const m = (r as { meta?: { rows_read?: number; rows_written?: number } } | undefined)?.meta;
  return m ? [["rowsRead", m.rows_read ?? 0], ["rowsWritten", m.rows_written ?? 0]] : [];
};

/** Which method costs what, per binding type. A string is one unit per call. */
const UNITS: Record<"kv" | "r2" | "queue", Units> = {
  kv: { get: "reads", getWithMetadata: "reads", put: "writes", delete: "writes", list: "lists" },
  r2: { put: "classA", delete: "classA", list: "classA", createMultipartUpload: "classA", get: "classB", head: "classB" },
  queue: { send: "sent", sendBatch: (_r, a) => ["sent", (a[0] as unknown[] | undefined)?.length ?? 0] },
};

function wrap<T extends object>(target: T, on: (method: string, result: unknown, args: unknown[]) => void, inner?: (method: string, result: unknown) => unknown): T {
  return new Proxy(target, {
    get(t, k) {
      const v = Reflect.get(t, k, t);
      if (typeof v !== "function" || typeof k === "symbol") return v;
      return (...args: unknown[]) => {
        const r = v.apply(t, args);
        const after = (x: unknown) => { on(k, x, args); return inner ? inner(k, x) : x; };
        return r instanceof Promise ? r.then(after) : after(r);
      };
    },
  });
}

/**
 * A binding that counts what it costs, under `name`. D1 counts rows read and written (rows
 * returned for first() and raw()), KV reads, writes and lists, R2 class A and B operations, a
 * queue the messages sent. Anything else passes through unchanged.
 */
export function metered<T>(name: string, kind: "d1" | "kv" | "r2" | "queue", binding: T): T {
  if (binding === null || typeof binding !== "object") return binding;
  if (kind === "d1") {
    const statement = (s: object): object => wrap(s, (m, r) => {
      if (m === "all" || m === "allSync" || m === "run") for (const [u, n] of d1Meta(r)) count(`${name}.${u}`, n);
      else if (m === "first" || m === "raw") count(`${name}.rowsRead`, rows(r));
    }, (m, r) => m === "bind" && r && typeof r === "object" ? statement(r) : r);
    return wrap(binding as object, () => {}, (m, r) => m === "prepare" && r && typeof r === "object" ? statement(r) : r) as T;
  }
  const units = UNITS[kind];
  return wrap(binding as object, (m, r, a) => {
    const u = units[m];
    if (typeof u === "string") count(`${name}.${u}`);
    else if (u) { const hit = u(r, a); if (hit) count(`${name}.${hit[0]}`, hit[1]); }
  }) as T;
}
