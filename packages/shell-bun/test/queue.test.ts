import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalQueue, type QueueBatch } from "../src/bindings/queue.ts";
import { scheduler } from "../src/priority.ts";

test("send and sendBatch reach the consumer in batches; acked by default", async () => {
  const q = new LocalQueue<{ n: number; at?: Date }>();
  const seen: { n: number; attempts: number; batch: number }[] = [];
  let batches = 0;
  q.consume((b) => { batches++; for (const m of b.messages) seen.push({ n: m.body.n, attempts: m.attempts, batch: b.messages.length }); }, { batchSize: 2 });
  await q.sendBatch([{ body: { n: 1, at: new Date(0) } }, { body: { n: 2 } }, { body: { n: 3 } }]);
  await q.drain();
  expect(seen.map((s) => s.n)).toEqual([1, 2, 3]);
  expect(seen.every((s) => s.attempts === 1 && s.batch <= 2)).toBe(true);
  expect(batches).toBe(2);
  expect(q.size()).toBe(0);
});

test("delaySeconds holds a message until it is due", async () => {
  const q = new LocalQueue<string>();
  const seen: string[] = [];
  q.consume((b) => { for (const m of b.messages) seen.push(m.body); });
  await q.send("later", { delaySeconds: 60 });
  await q.send("now");
  await q.drain();
  expect(seen).toEqual(["now"]);
  await q.drain(Date.now() + 61_000);
  expect(seen).toEqual(["now", "later"]);
});

test("retry, a throwing handler, and maxRetries", async () => {
  const q = new LocalQueue<string>();
  const tries: Record<string, number[]> = {};
  const errors: unknown[] = [];
  q.consume((b: QueueBatch<string>) => {
    for (const m of b.messages) (tries[m.body] ??= []).push(m.attempts);
    const flaky = b.messages.find((m) => m.body === "flaky");
    if (flaky) flaky.retry({ delaySeconds: 30 });
    if (b.messages.some((m) => m.body === "boom")) throw new Error("boom");
  }, { maxRetries: 2 }, (e) => errors.push(e));
  await q.send("flaky");
  await q.drain();
  expect(tries.flaky).toEqual([1]);
  // Each retry is due 30s after the last, so a drain to a minute out sees two more, then it's dropped.
  await q.drain(Date.now() + 61_000);
  expect(tries.flaky).toEqual([1, 2, 3]);
  expect(q.size()).toBe(0);

  await q.send("boom");
  await q.drain();
  expect(tries.boom).toEqual([1, 2, 3]);   // first delivery + maxRetries, then dropped
  expect(errors).toHaveLength(3);
  expect(q.size()).toBe(0);
});

test("deadLetterQueue: a message past maxRetries moves to that queue, as new, instead of being dropped", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "rb-queue-")), "queues.sqlite");
  const jobs = new LocalQueue<string>(path, "jobs"), dlq = new LocalQueue<string>(path, "jobs-dlq");
  jobs.consume(() => { throw new Error("no"); }, { maxRetries: 1, deadLetterQueue: "jobs-dlq" }, () => {});
  await jobs.send("bad");
  await jobs.drain();   // the retry falls due after this drain's `now`: the next one delivers it
  await jobs.drain();
  expect(jobs.size()).toBe(0);
  const dead: [string, number][] = [];
  dlq.consume((b: QueueBatch<string>) => { for (const m of b.messages) dead.push([m.body, m.attempts]); });
  await dlq.drain();
  expect(dead).toEqual([["bad", 1]]);
  expect(dlq.size()).toBe(0);
});

test("messages outlive the process; a batch in flight comes back after its lease", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "rb-queue-")), "queues.sqlite");
  const a = new LocalQueue<number>(path, "jobs");
  await a.send(7);
  a.consume(() => new Promise(() => {}), { priority: "high" });   // takes the batch and never finishes (high: it holds no low slot)
  await Bun.sleep(20);

  const b = new LocalQueue<number>(path, "jobs");
  const seen: number[][] = [];
  b.consume((batch) => { seen.push(batch.messages.map((m) => m.attempts)); });
  await b.drain();
  expect(seen).toEqual([]);
  await b.drain(Date.now() + 16 * 60_000);
  expect(seen).toEqual([[2]]);
  // Queues share the file, not their messages.
  expect(new LocalQueue(path, "other").size()).toBe(0);
});

test("a batch waits for a low slot before its messages are leased; priority says otherwise", async () => {
  const sched = scheduler({ cores: 1, budget: { cpu: 1, reserve: 0 }, everyMs: 0 });   // 1 slot
  let release!: () => void;
  const hold = sched.run("low", () => new Promise<void>((r) => (release = r)));
  const q = new LocalQueue<number>(), urgent = new LocalQueue<number>();
  const seen: string[] = [];
  q.consume((b) => { for (const m of b.messages) seen.push(`low ${m.body}`); }, { scheduler: sched });
  urgent.consume((b) => { for (const m of b.messages) seen.push(`high ${m.body}`); }, { scheduler: sched, priority: "high" });
  await q.send(1); await urgent.send(2);
  await Bun.sleep(20);
  expect(seen).toEqual(["high 2"]);
  expect(sched.stats().queued.low).toBe(1);
  release(); await hold;
  await q.drain();
  expect(seen).toEqual(["high 2", "low 1"]);
});

test("a batch past its timeout gives its slot back; its messages are due again and its late verdicts don't count", async () => {
  const sched = scheduler({ cores: 1, budget: { cpu: 1, reserve: 0 }, everyMs: 0 });   // 1 slot
  const q = new LocalQueue<number>();
  const errors: unknown[] = [], seen: number[][] = [];
  let finish!: () => void;
  let first = true;
  q.consume(async (b) => {
    seen.push(b.messages.map((m) => m.attempts));
    if (first) { first = false; await new Promise<void>((r) => (finish = r)); b.ackAll(); }
    else b.retryAll({ delaySeconds: 60 });
  }, { scheduler: sched, timeoutMs: 30 }, (e) => errors.push(e));
  await q.send(1);
  await Bun.sleep(60);
  expect(String(errors[0])).toContain("stopped after 30 ms");
  await q.drain();
  expect(seen).toEqual([[1], [2]]);                 // delivered again at once, the slot free
  finish(); await Bun.sleep(10);
  expect(q.size()).toBe(1);                          // the stuck handler's late ack didn't drop it
  expect(sched.stats().running.low).toBe(0);
});
