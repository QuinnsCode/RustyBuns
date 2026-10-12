// Cloudflare Queues off the edge: a Queue binding (send, sendBatch) over one
// sqlite table, and a consumer loop in the same process that hands due
// messages to the Worker's `queue(batch, env, ctx)` in batches. As on
// Cloudflare, a message the handler doesn't ack is retried (all of them when it
// throws), after `delaySeconds` or the consumer's retryDelay, until it has been
// delivered maxRetries + 1 times; then it is dropped. Messages survive a
// restart: a batch in flight when the process died comes back after its lease.
//
// Each batch is background work: it waits for a low slot on the host's scheduler (priority.ts)
// before its messages are picked and leased. The consumer's `priority` says otherwise.

import { Database } from "bun:sqlite";
import { deserialize, serialize } from "node:v8";
import { hostScheduler, type Priority, type Scheduler } from "../priority.ts";

/** The consumer's settings, as in wrangler's `queues.consumers`. */
export interface QueueConsumerSettings {
  /** Messages per batch. @default 10 */
  batchSize?: number;
  /** Retries after the first delivery before a message is dropped. @default 3 */
  maxRetries?: number;
  /** Seconds before a retry, when retry() doesn't say. @default 0 */
  retryDelay?: number;
  /** The scheduler class each batch runs at. @default "low" */
  priority?: Priority;
  /** @default the host's, hostScheduler() */
  scheduler?: Pick<Scheduler, "run">;
}

export interface QueueSendOptions { delaySeconds?: number; contentType?: string }

export interface QueueMessage<Body = unknown> {
  readonly id: string;
  readonly timestamp: Date;
  readonly body: Body;
  /** Deliveries so far, this one included: 1 the first time. */
  readonly attempts: number;
  ack(): void;
  retry(opts?: { delaySeconds?: number }): void;
}

export interface QueueBatch<Body = unknown> {
  readonly queue: string;
  readonly messages: readonly QueueMessage<Body>[];
  ackAll(): void;
  retryAll(opts?: { delaySeconds?: number }): void;
}

/** A batch in flight is held this long; if it's still out then (the process died), it is delivered again. */
const LEASE_MS = 15 * 60_000;
/** How often the consumer looks for messages whose delay is up. A send wakes it at once. */
const POLL_MS = 1000;

/** A message body is at most 128 KB, as on Cloudflare. */
export const QUEUE_MAX_MESSAGE_BYTES = 128_000;

interface Row { id: string; body: Uint8Array; attempts: number; sent_at: number }
type Verdict = { ack: true } | { ack: false; delaySeconds?: number };

export class LocalQueue<Body = unknown> {
  private db: Database;
  private consumer?: { handler: (batch: QueueBatch<Body>) => unknown; settings: QueueConsumerSettings; onError: (err: unknown) => void };
  private draining?: Promise<number>;
  /** Asked for during a drain: go round again, up to the latest `until` asked for. */
  private again?: number;

  constructor(path: string = ":memory:", readonly name = "queue", renamedFrom?: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(`CREATE TABLE IF NOT EXISTS queue_messages (
      id TEXT PRIMARY KEY, queue TEXT NOT NULL, body BLOB NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      visible_at INTEGER NOT NULL, sent_at INTEGER NOT NULL)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS queue_messages_due ON queue_messages (queue, visible_at)`);
    if (renamedFrom) this.db.query(`UPDATE queue_messages SET queue = ? WHERE queue = ?`).run(name, renamedFrom);
  }

  async send(body: Body, opts: QueueSendOptions = {}): Promise<void> {
    this.insert(this.encode(body), opts.delaySeconds);
    this.kick();
  }

  async sendBatch(messages: Iterable<{ body: Body; delaySeconds?: number; contentType?: string }>, opts: { delaySeconds?: number } = {}): Promise<void> {
    // Encode them all first, so one too large refuses the batch before any of it is queued.
    const rows = [...messages].map((m) => [this.encode(m.body), m.delaySeconds ?? opts.delaySeconds] as const);
    this.db.transaction(() => { for (const [b, d] of rows) this.insert(b, d); })();
    this.kick();
  }

  private encode(body: Body): Buffer {
    const b = serialize(body);
    if (b.byteLength > QUEUE_MAX_MESSAGE_BYTES) throw new Error(`Queue send failed: message length of ${b.byteLength} bytes exceeds limit of ${QUEUE_MAX_MESSAGE_BYTES}`);
    return b;
  }

  private insert(body: Buffer, delaySeconds = 0) {
    const now = Date.now();
    this.db.query(`INSERT INTO queue_messages (id, queue, body, visible_at, sent_at) VALUES (?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), this.name, body, now + delaySeconds * 1000, now);
  }

  /** Messages waiting or in flight. */
  size(): number {
    return (this.db.query(`SELECT COUNT(*) AS n FROM queue_messages WHERE queue = ?`).get(this.name) as { n: number }).n;
  }

  /**
   * Be this queue's consumer: due messages go to `handler` in batches, from now
   * until the returned stop() is called. The poll timer is unref'd, so it never
   * keeps a process alive.
   */
  consume(handler: (batch: QueueBatch<Body>) => unknown, settings: QueueConsumerSettings = {}, onError: (err: unknown) => void = (e) => console.error(`[queue ${this.name}]`, e)): () => void {
    this.consumer = { handler, settings, onError };
    const timer = setInterval(() => this.kick(), POLL_MS);
    (timer as { unref?: () => void }).unref?.();
    this.kick();
    return () => { clearInterval(timer); this.consumer = undefined; };
  }

  private kick() {
    if (this.consumer) void this.drain().catch(this.consumer.onError);
  }

  /**
   * Deliver every message due by `until` (default now) to the consumer, batch
   * after batch, and resolve with how many deliveries were made. One drain
   * runs at a time; a call during one makes it go round again.
   */
  drain(until?: number): Promise<number> {
    if (this.draining) { this.again = Math.max(this.again ?? 0, until ?? Date.now()); return this.draining; }
    this.draining = (async () => {
      let n = 0, to: number | undefined = until;
      try {
        for (;;) {
          for (let got; (got = await this.deliver(to ?? Date.now())) > 0;) n += got;
          if (this.again === undefined) break;
          to = this.again;
          this.again = undefined;
        }
      } finally { this.draining = undefined; }
      return n;
    })();
    return this.draining;
  }

  private deliver(until: number): Promise<number> {
    const c = this.consumer;
    if (!c) return Promise.resolve(0);
    return (c.settings.scheduler ?? hostScheduler()).run(c.settings.priority ?? "low", () => this.deliverNow(until));
  }

  private async deliverNow(until: number): Promise<number> {
    const c = this.consumer;
    if (!c) return 0;
    const rows = this.db.query(`SELECT id, body, attempts, sent_at FROM queue_messages WHERE queue = ? AND visible_at <= ? ORDER BY visible_at, rowid LIMIT ?`)
      .all(this.name, until, c.settings.batchSize ?? 10) as Row[];
    if (!rows.length) return 0;
    const lease = this.db.query(`UPDATE queue_messages SET attempts = attempts + 1, visible_at = ? WHERE id = ?`);
    this.db.transaction(() => { for (const r of rows) lease.run(Date.now() + LEASE_MS, r.id); })();

    const verdicts = new Map<string, Verdict>();
    const messages = rows.map((r): QueueMessage<Body> => ({
      id: r.id,
      timestamp: new Date(r.sent_at),
      body: deserialize(r.body) as Body,
      attempts: r.attempts + 1,
      ack: () => void verdicts.set(r.id, { ack: true }),
      retry: (o) => void verdicts.set(r.id, { ack: false, delaySeconds: o?.delaySeconds }),
    }));
    // Batch-wide calls cover the messages that weren't told otherwise.
    const all = (v: Verdict) => { for (const m of messages) if (!verdicts.has(m.id)) verdicts.set(m.id, v); };
    const batch: QueueBatch<Body> = {
      queue: this.name,
      messages,
      ackAll: () => all({ ack: true }),
      retryAll: (o) => all({ ack: false, delaySeconds: o?.delaySeconds }),
    };
    let threw = false;
    try { await c.handler(batch); } catch (e) { threw = true; c.onError(e); }

    const drop = this.db.query(`DELETE FROM queue_messages WHERE id = ?`);
    const later = this.db.query(`UPDATE queue_messages SET visible_at = ? WHERE id = ?`);
    this.db.transaction(() => {
      for (const m of messages) {
        const v = verdicts.get(m.id) ?? (threw ? { ack: false } : { ack: true });
        if (v.ack || m.attempts > (c.settings.maxRetries ?? 3)) drop.run(m.id);
        else later.run(Date.now() + (v.delaySeconds ?? c.settings.retryDelay ?? 0) * 1000, m.id);
      }
    })();
    return rows.length;
  }
}

export const queue = <Body = unknown>(path?: string, name?: string, renamedFrom?: string) => new LocalQueue<Body>(path, name, renamedFrom);
