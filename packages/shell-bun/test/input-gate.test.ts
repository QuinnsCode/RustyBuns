import { expect, test } from "bun:test";
import { durableObject, type LocalDurableObjectState } from "../src/index.ts";

// Cloudflare's input gate: no new event starts while a storage call is in flight, so a
// read-then-write counter is safe under concurrent requests.
class Counter {
  constructor(private ctx: LocalDurableObjectState) {}
  async fetch() {
    const n = ((await this.ctx.storage.get<number>("n")) ?? 0) + 1;
    await this.ctx.storage.put("n", n);
    return Response.json(n);
  }
}

test("input gate: concurrent read-modify-write on one object loses no updates", async () => {
  const ns = durableObject(Counter as any, {});
  const stub = ns.get(ns.idFromName("a"));
  const ns10 = await Promise.all(Array.from({ length: 10 }, () => stub.fetch("https://x/").then((r) => r.json())));
  expect(new Set(ns10).size).toBe(10);
  expect(Math.max(...(ns10 as number[]))).toBe(10);
});

// rwsdk/db's shape: an async initialize() over sync sql, called by every event at once.
class Migrating {
  private done = false;
  constructor(private ctx: LocalDurableObjectState) {}
  async initialize() {
    if (this.done) return;
    for (const stmt of ["CREATE TABLE users (id)", "CREATE TABLE orgs (id)"]) {
      await Promise.resolve();
      this.ctx.storage.sql!.exec(stmt);
    }
    this.done = true;
  }
  async count() { await this.initialize(); return this.ctx.storage.sql!.exec("SELECT count(*) AS n FROM users").one().n; }
}

test("input gate: events arrive as separate tasks, so a microtask-only migration runs once", async () => {
  const ns = durableObject(Migrating as any, {});
  const stub = ns.get(ns.idFromName("a")) as any;
  expect(await Promise.all(Array.from({ length: 20 }, () => stub.count()))).toEqual(Array(20).fill(0));
});
