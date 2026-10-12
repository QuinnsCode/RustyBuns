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
