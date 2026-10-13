// Cloudflare Workflows off the edge: a Workflow binding (create, createBatch, get) and its
// instances (status, pause, resume, terminate, restart, sendEvent) over one sqlite file, with the
// app's WorkflowEntrypoint class running in this process.
//
// Durable the way the edge's are: each step.do result, sleep deadline and received event is
// stored under the step's name (and how many times that name came before it in the run). An
// instance that was running when the process died runs again from the top on the next bind(), and
// its finished steps return their stored results instead of running twice; a sleep picks up its
// remaining time. step.do retries as configured (default 5 times, 10 s exponential, as on the
// edge); a NonRetryableError fails it at once.

import { Database } from "bun:sqlite";
import { deserialize, serialize } from "node:v8";

export type WorkflowStatus = "queued" | "running" | "paused" | "errored" | "terminated" | "complete" | "waiting" | "unknown";
export type WorkflowDuration = number | string;
export interface WorkflowStepConfig {
  retries?: { limit: number; delay: WorkflowDuration; backoff?: "constant" | "linear" | "exponential" };
  timeout?: WorkflowDuration;
}
export interface WorkflowEvent<P = unknown> { payload: Readonly<P>; timestamp: Date; instanceId: string }
export interface WorkflowStep {
  do<T>(name: string, callback: () => Promise<T> | T): Promise<T>;
  do<T>(name: string, config: WorkflowStepConfig, callback: () => Promise<T> | T): Promise<T>;
  sleep(name: string, duration: WorkflowDuration): Promise<void>;
  sleepUntil(name: string, timestamp: Date | number): Promise<void>;
  waitForEvent<T = unknown>(name: string, opts: { type: string; timeout?: WorkflowDuration }): Promise<{ payload: T; timestamp: Date; type: string }>;
}
export interface InstanceStatus { status: WorkflowStatus; error?: { name: string; message: string }; output?: unknown }
/** The class an app exports: `class X extends WorkflowEntrypoint { run(event, step) }`. */
export type WorkflowCtor<Env> = new (ctx: unknown, env: Env) => { run(event: WorkflowEvent<any>, step: WorkflowStep): unknown };

const UNITS: Record<string, number> = { millisecond: 1, second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };
/** 5000 or "5 seconds" / "1 minute" / "2 days", in ms. */
export function durationMs(d: WorkflowDuration): number {
  if (typeof d === "number") return d;
  const m = d.trim().match(/^(\d+(?:\.\d+)?)\s*([a-z]+?)s?$/i);
  const unit = m && UNITS[m[2]!.toLowerCase()];
  if (!unit) throw new TypeError(`Workflows: can't read the duration "${d}"`);
  return Number(m![1]) * unit;
}

const DEFAULT_STEP: Required<WorkflowStepConfig> = { retries: { limit: 5, delay: 10_000, backoff: "exponential" }, timeout: "10 minutes" };
/** waitForEvent's default timeout, as on the edge. */
const EVENT_TIMEOUT = "24 hours";
const ID = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,99}$/;

/** Thrown out of a run that was terminated or restarted: not an error, the run just stops. */
class Stopped extends Error {}

interface Row { id: string; params: Uint8Array; status: WorkflowStatus; output: Uint8Array | null; error: string | null; created_at: number }
interface Live { stop?: (why: "terminate" | "restart") => void; pausedUntil?: PromiseWithResolvers<void>; events: Set<() => void> }

export class LocalWorkflow<Params = unknown, Env = unknown> {
  private db: Database;
  private ctor?: WorkflowCtor<Env>;
  private env?: Env;
  private live = new Map<string, Live>();
  private runs = new Map<string, Promise<void>>();

  constructor(path: string = ":memory:", readonly name = "workflow") {
    this.db = new Database(path, { create: true });
    this.db.exec(`PRAGMA journal_mode = WAL`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS workflow_instances (workflow TEXT NOT NULL, id TEXT NOT NULL, params BLOB NOT NULL,
      status TEXT NOT NULL, output BLOB, error TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (workflow, id))`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS workflow_steps (workflow TEXT NOT NULL, instance TEXT NOT NULL, key TEXT NOT NULL,
      value BLOB NOT NULL, PRIMARY KEY (workflow, instance, key))`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS workflow_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, workflow TEXT NOT NULL,
      instance TEXT NOT NULL, type TEXT NOT NULL, payload BLOB NOT NULL, at INTEGER NOT NULL)`);
  }

  /** The app's class, once the Worker has loaded. Instances created before now, or left running
   *  when the process stopped, start (again) here. */
  bind(ctor: WorkflowCtor<Env>, env: Env): this {
    this.ctor = ctor; this.env = env;
    const due = this.db.query(`SELECT id FROM workflow_instances WHERE workflow = ? AND status IN ('queued', 'running', 'waiting') ORDER BY created_at`).all(this.name) as { id: string }[];
    for (const { id } of due) this.start(id);
    return this;
  }

  async create(opts: { id?: string; params?: Params } = {}): Promise<LocalWorkflowInstance> {
    const id = opts.id ?? crypto.randomUUID();
    if (!ID.test(id)) throw new Error(`Workflows: instance id "${id}" must be 1-100 letters, digits, - or _`);
    try {
      this.db.query(`INSERT INTO workflow_instances (workflow, id, params, status, created_at) VALUES (?, ?, ?, 'queued', ?)`)
        .run(this.name, id, serialize(opts.params ?? {}), Date.now());
    } catch (e) {
      if (String(e).includes("UNIQUE")) throw new Error(`Workflows: an instance with id "${id}" already exists`);
      throw e;
    }
    this.start(id);
    return new LocalWorkflowInstance(this, id);
  }

  async createBatch(batch: { id?: string; params?: Params }[]): Promise<LocalWorkflowInstance[]> {
    const out: LocalWorkflowInstance[] = [];
    for (const o of batch) out.push(await this.create(o));
    return out;
  }

  async get(id: string): Promise<LocalWorkflowInstance> {
    if (!this.row(id)) throw new Error(`Workflows: no instance "${id}" of ${this.name}`);
    return new LocalWorkflowInstance(this, id);
  }

  /** Resolves when the instance's current run has stopped (finished, failed, paused for good or terminated). For tests. */
  settled(id: string): Promise<void> { return this.runs.get(id) ?? Promise.resolve(); }

  // ---- instance controls (LocalWorkflowInstance calls these) ----

  /** @internal */ row(id: string) {
    return this.db.query(`SELECT * FROM workflow_instances WHERE workflow = ? AND id = ?`).get(this.name, id) as Row | null;
  }

  /** @internal */ status(id: string): InstanceStatus {
    const r = this.row(id);
    if (!r) return { status: "unknown" };
    return { status: r.status, ...(r.error ? { error: JSON.parse(r.error) } : {}), ...(r.output ? { output: deserialize(r.output) } : {}) };
  }

  /** @internal */ pause(id: string) {
    const l = this.live.get(id);
    if (!l || l.pausedUntil) return;
    l.pausedUntil = Promise.withResolvers();
    this.setStatus(id, "paused");
  }

  /** @internal */ resume(id: string) {
    const l = this.live.get(id);
    if (l?.pausedUntil) { const p = l.pausedUntil; l.pausedUntil = undefined; this.setStatus(id, "running"); p.resolve(); return; }
    // Paused when the process stopped: nothing is live, so it starts again.
    if (this.row(id)?.status === "paused") { this.setStatus(id, "queued"); this.start(id); }
  }

  /** @internal */ async terminate(id: string) {
    const s = this.row(id)?.status;
    if (!s || s === "complete" || s === "errored" || s === "terminated") throw new Error(`Workflows: instance "${id}" is ${s ?? "unknown"} and can't be terminated`);
    this.live.get(id)?.stop?.("terminate");
    this.setStatus(id, "terminated");
    await this.runs.get(id);
  }

  /** @internal */ async restart(id: string) {
    if (!this.row(id)) throw new Error(`Workflows: no instance "${id}" of ${this.name}`);
    this.live.get(id)?.stop?.("restart");
    await this.runs.get(id);
    this.db.transaction(() => {
      this.db.query(`DELETE FROM workflow_steps WHERE workflow = ? AND instance = ?`).run(this.name, id);
      this.db.query(`UPDATE workflow_instances SET status = 'queued', output = NULL, error = NULL WHERE workflow = ? AND id = ?`).run(this.name, id);
    })();
    this.start(id);
  }

  /** @internal */ sendEvent(id: string, ev: { type: string; payload?: unknown }) {
    if (!this.row(id)) throw new Error(`Workflows: no instance "${id}" of ${this.name}`);
    this.db.query(`INSERT INTO workflow_events (workflow, instance, type, payload, at) VALUES (?, ?, ?, ?, ?)`)
      .run(this.name, id, ev.type, serialize(ev.payload ?? null), Date.now());
    for (const wake of this.live.get(id)?.events ?? []) wake();
  }

  // ---- the run ----

  private setStatus(id: string, status: WorkflowStatus) {
    this.db.query(`UPDATE workflow_instances SET status = ? WHERE workflow = ? AND id = ?`).run(status, this.name, id);
  }

  private start(id: string) {
    if (!this.ctor || this.runs.has(id)) return;
    const run = this.run(id).finally(() => { this.runs.delete(id); this.live.delete(id); });
    this.runs.set(id, run);
  }

  private async run(id: string) {
    const r = this.row(id)!;
    let stopped: "terminate" | "restart" | undefined;
    const stop = Promise.withResolvers<never>();
    stop.promise.catch(() => {});
    const live: Live = { events: new Set(), stop: (why) => { stopped = why; stop.reject(new Stopped(why)); live.pausedUntil?.resolve(); } };
    this.live.set(id, live);
    this.setStatus(id, "running");

    const seen = new Map<string, number>();
    const keyOf = (kind: string, name: string) => { const k = `${kind}:${name}`; const n = seen.get(k) ?? 0; seen.set(k, n + 1); return `${k}#${n}`; };
    const stored = (key: string) => {
      const s = this.db.query(`SELECT value FROM workflow_steps WHERE workflow = ? AND instance = ? AND key = ?`).get(this.name, id, key) as { value: Uint8Array } | null;
      return s ? { v: deserialize(s.value) } : undefined;
    };
    const store = (key: string, v: unknown) => this.db.query(`INSERT OR REPLACE INTO workflow_steps (workflow, instance, key, value) VALUES (?, ?, ?, ?)`).run(this.name, id, key, serialize(v));
    // Every step waits out a pause, and stops with the run.
    const gate = async () => { if (stopped) throw new Stopped(stopped); if (live.pausedUntil) await live.pausedUntil.promise; if (stopped) throw new Stopped(stopped); };
    const wait = (ms: number) => Promise.race([new Promise<void>((res) => setTimeout(res, Math.max(0, ms))), stop.promise]);

    const step: WorkflowStep = {
      do: async (name: string, a: unknown, b?: unknown) => {
        const [config, cb] = (typeof a === "function" ? [{}, a] : [a, b]) as [WorkflowStepConfig, () => unknown];
        const key = keyOf("do", name);
        await gate();
        const hit = stored(key);
        if (hit) return hit.v as any;
        const retries = { ...DEFAULT_STEP.retries, ...config.retries };
        const timeout = durationMs(config.timeout ?? DEFAULT_STEP.timeout);
        for (let attempt = 0; ; attempt++) {
          try {
            let timer: Timer | undefined;
            const out = await Promise.race([
              Promise.resolve().then(cb),
              new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`Workflows: step "${name}" timed out after ${timeout} ms`)), timeout); }),
              stop.promise,
            ]).finally(() => clearTimeout(timer));
            store(key, out);
            return out as any;
          } catch (e) {
            if (e instanceof Stopped || (e as Error)?.name === "NonRetryableError" || attempt >= retries.limit) throw e;
            const base = durationMs(retries.delay);
            await wait(retries.backoff === "constant" ? base : retries.backoff === "linear" ? base * (attempt + 1) : base * 2 ** attempt);
            await gate();
          }
        }
      },
      sleep: (name, duration) => sleepTo(keyOf("sleep", name), Date.now() + durationMs(duration)),
      sleepUntil: (name, ts) => sleepTo(keyOf("sleep", name), typeof ts === "number" ? ts : ts.getTime()),
      waitForEvent: async <T>(name: string, opts: { type: string; timeout?: WorkflowDuration }) => {
        const key = keyOf("event", name);
        await gate();
        const hit = stored(key);
        if (hit) return hit.v as { payload: T; timestamp: Date; type: string };
        // The deadline is kept too, so a restart doesn't give the wait a fresh timeout.
        const dkey = `${key}:deadline`;
        const deadline = (stored(dkey)?.v as number | undefined) ?? (store(dkey, Date.now() + durationMs(opts.timeout ?? EVENT_TIMEOUT)), stored(dkey)!.v as number);
        this.setStatus(id, "waiting");
        for (;;) {
          const ev = this.db.query(`SELECT seq, payload, at FROM workflow_events WHERE workflow = ? AND instance = ? AND type = ? ORDER BY seq LIMIT 1`)
            .get(this.name, id, opts.type) as { seq: number; payload: Uint8Array; at: number } | null;
          if (ev) {
            const got = { payload: deserialize(ev.payload) as T, timestamp: new Date(ev.at), type: opts.type };
            this.db.transaction(() => { store(key, got); this.db.query(`DELETE FROM workflow_events WHERE seq = ?`).run(ev.seq); })();
            if (!live.pausedUntil) this.setStatus(id, "running");
            return got;
          }
          if (Date.now() >= deadline) { this.setStatus(id, "running"); throw new Error(`Workflows: waitForEvent "${name}" timed out waiting for "${opts.type}"`); }
          let wake!: () => void;
          const arrived = new Promise<void>((res) => { wake = res; live.events.add(wake); });
          await Promise.race([arrived, wait(deadline - Date.now())]).finally(() => live.events.delete(wake));
          await gate();
        }
      },
    };
    const sleepTo = async (key: string, until: number) => {
      await gate();
      const at = (stored(key)?.v as number | undefined) ?? (store(key, until), until);
      if (at > Date.now()) {
        this.setStatus(id, "waiting");
        await wait(at - Date.now());
        if (!live.pausedUntil && !stopped) this.setStatus(id, "running");
      }
      await gate();
    };

    try {
      const wf = new this.ctor!({ waitUntil() {}, passThroughOnException() {} }, this.env!);
      const output = await Promise.race([Promise.resolve().then(() => wf.run({ payload: deserialize(r.params) as any, timestamp: new Date(r.created_at), instanceId: id }, step)), stop.promise]);
      this.db.query(`UPDATE workflow_instances SET status = 'complete', output = ? WHERE workflow = ? AND id = ?`).run(serialize(output ?? null), this.name, id);
    } catch (e) {
      if (e instanceof Stopped || stopped) return;
      const err = e as Error;
      console.error(`[workflow ${this.name}/${id}]`, e);
      this.db.query(`UPDATE workflow_instances SET status = 'errored', error = ? WHERE workflow = ? AND id = ?`)
        .run(JSON.stringify({ name: err?.name ?? "Error", message: err?.message ?? String(e) }), this.name, id);
    }
  }
}

/** What create() and get() return: the edge's WorkflowInstance. */
export class LocalWorkflowInstance {
  constructor(private wf: LocalWorkflow<any, any>, readonly id: string) {}
  async status(): Promise<InstanceStatus> { return this.wf.status(this.id); }
  async pause() { this.wf.pause(this.id); }
  async resume() { this.wf.resume(this.id); }
  async terminate() { await this.wf.terminate(this.id); }
  async restart() { await this.wf.restart(this.id); }
  async sendEvent(ev: { type: string; payload?: unknown }) { this.wf.sendEvent(this.id, ev); }
}

export const workflow = <Params = unknown, Env = unknown>(path?: string, name?: string) => new LocalWorkflow<Params, Env>(path, name);
