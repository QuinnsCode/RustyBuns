import { test, expect, beforeEach } from "bun:test";
import { d1, kv, r2, queue, durableObject, within, metered, usageSnapshot, resetUsage, type LocalDurableObjectState } from "../src/index.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeEach(resetUsage);

class Counter {
  constructor(private ctx: LocalDurableObjectState) {}
  async fetch() { return new Response("ok"); }
  async bump(by: number) { const n = ((await this.ctx.storage.get<number>("n")) ?? 0) + by; await this.ctx.storage.put("n", n); return n; }
}

test("a cron tick's DO calls count toward the tick: requests, distinct objects, busy time", async () => {
  const ns = durableObject(Counter as any, {}, { name: "COUNTER" });
  const sweep = async () => {
    // three sweeps, two of them on the same object
    for (const name of ["a", "b", "a"]) await (ns.getByName(name) as any).bump(1);
  };
  await within("cron * * * * *", sweep);
  await within("cron * * * * *", sweep);
  const c = usageSnapshot().causes["cron * * * * *"]!;
  expect(c.runs).toBe(2);
  expect(c.ops["COUNTER.requests"]).toBe(6);
  expect(c.ops["COUNTER.objects"]).toBe(4);   // a and b, once per tick
  expect(c.ops["COUNTER.busyMs"]).toBeGreaterThanOrEqual(0);
  // A namespace without a name counts nothing.
  await within("request", () => (durableObject(Counter as any, {}).getByName("x") as any).bump(1));
  expect(usageSnapshot().causes.request!.ops).toEqual({});
});

test("metered: D1 rows, KV reads and writes, R2 classes, queue sends, each under its cause", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-usage-"));
  const db = metered("DB", "d1", d1());
  const store = metered("KV", "kv", kv());
  const bucket = metered("BUCKET", "r2", r2(join(dir, "r2")));
  const jobs = metered("JOBS", "queue", queue());
  await db.exec("CREATE TABLE t (n INTEGER)");
  await within("request", async () => {
    await db.prepare("INSERT INTO t (n) VALUES (?), (?)").bind(1, 2).run();
    await db.prepare("SELECT * FROM t").all();
    await db.prepare("SELECT * FROM t").first();
    await db.batch([db.prepare("SELECT * FROM t"), db.prepare("DELETE FROM t WHERE n = 1")]);
    await store.put("k", "v");
    await store.get("k");
    await bucket.put("o", "x");
    await bucket.get("o");
    await bucket.head("o");
    await jobs.send({ a: 1 });
    await jobs.sendBatch([{ body: 1 }, { body: 2 }]);
  });
  expect(usageSnapshot().causes.request!.ops).toEqual({
    "DB.rowsRead": 5, "DB.rowsWritten": 3,
    "KV.writes": 1, "KV.reads": 1,
    "BUCKET.classA": 1, "BUCKET.classB": 2,
    "JOBS.sent": 3,
  });
  // Outside any cause, work lands in "other".
  await store.get("k");
  expect(usageSnapshot().causes.other!.ops["KV.reads"]).toBe(1);
});
