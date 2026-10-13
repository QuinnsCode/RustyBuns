// The twins refuse what the edge refuses (#867), with the edge's message, so an app that passes
// locally doesn't fail on its first deploy. apps/borg's --limits grid checks the same over HTTP.
import { expect, test } from "bun:test";
import { d1, D1_MAX_PARAMS } from "../src/bindings/d1.ts";
import { kv } from "../src/bindings/kv.ts";
import { LocalQueue } from "../src/bindings/queue.ts";
import { storage } from "../src/bindings/storage.ts";
import { DO_MAX_VALUE_BYTES, LocalDurableObjectNamespace, LocalDurableObjectState } from "../src/bindings/durable-object.ts";
import { capped, edgeLimits } from "../src/edge-limits.ts";

test("D1: 100 bound parameters pass, 101 are refused", async () => {
  const db = d1();
  const q = (n: number) => db.prepare(`SELECT ${Array(n).fill("?").join(", ")}`).bind(...Array.from({ length: n }, (_, i) => i));
  expect(await q(D1_MAX_PARAMS).first()).not.toBeNull();
  await expect(q(101).first()).rejects.toThrow("too many SQL variables");
  await expect(q(101).all()).rejects.toThrow("too many SQL variables");
  await expect(db.batch([q(1), q(101)])).rejects.toThrow("too many SQL variables");
});

test("KV: a 512-byte key works, 513 bytes are refused on put, get and delete", async () => {
  const ns = kv();
  await ns.put("k".repeat(512), "v");
  expect(await ns.get("k".repeat(512))).toBe("v");
  // Bytes, not characters: 171 three-byte characters is 513.
  const long = "€".repeat(171);
  await expect(ns.put(long, "v")).rejects.toThrow("414 UTF-8 encoded length of 513 exceeds key length limit of 512");
  await expect(ns.get(long)).rejects.toThrow("414");
  await expect(ns.delete(long)).rejects.toThrow("414");
});

test("Queues: a message over 128 KB is refused, and refuses its whole batch", async () => {
  const q = new LocalQueue();
  await q.send({ pad: "x".repeat(100_000) });
  await expect(q.send({ pad: "x".repeat(140_000) })).rejects.toThrow("exceeds limit of 128000");
  await expect(q.sendBatch([{ body: "small" }, { body: "x".repeat(140_000) }])).rejects.toThrow("exceeds limit");
  expect(q.size()).toBe(1);
});

test("Durable Objects: a value over 2 MiB is refused and not stored", async () => {
  const id = new LocalDurableObjectNamespace(class { fetch() { return new Response(); } }, {}).idFromName("limits");
  const state = new LocalDurableObjectState(id, storage(), () => {});
  await state.storage.put("ok", "x".repeat(1_000_000));
  await expect(state.storage.put("big", "x".repeat(3_000_000))).rejects.toThrow(`Values cannot be larger than ${DO_MAX_VALUE_BYTES} bytes`);
  expect(await state.storage.get("big")).toBeUndefined();
});

// Memory and CPU (#894): the host can't cap an isolate, so it measures the request and swaps the
// Worker's answer for the edge's 503.
test("a request that grows memory past 128 MB gets the edge's 503", async () => {
  let held: Uint8Array[] = [];
  const res = await capped({}, () => { held = Array.from({ length: 200 }, () => new Uint8Array(1 << 20).fill(1)); return new Response("ok"); });
  expect(held.length).toBe(200);
  expect(res.status).toBe(503);
  expect(await res.text()).toContain("Error 1102: Worker exceeded resource limits (memory grew");
});

test("CPU over cpuMs is refused, under it passes, and unset is no cap", async () => {
  const spin = () => { const end = performance.now() + 60; while (performance.now() < end); return new Response("ok"); };
  expect((await capped({ cpuMs: 20 }, spin)).status).toBe(503);
  expect((await capped({ cpuMs: 5_000 }, spin)).status).toBe(200);
  expect((await capped({}, spin)).status).toBe(200);
});

test("a bundle that swaps globalThis.process for unenv's doesn't break the limits", async () => {
  const real = globalThis.process;
  const nope = () => { throw new Error("[unenv] process.cpuUsage is not implemented yet!"); };
  Object.defineProperty(globalThis, "process", { value: { ...real, cpuUsage: nope, memoryUsage: Object.assign(nope, { rss: nope }) }, configurable: true });
  try {
    expect((await capped({ cpuMs: 5_000 }, () => new Response("ok"))).status).toBe(200);
  } finally {
    Object.defineProperty(globalThis, "process", { value: real, configurable: true });
  }
});

test("RB_CPU_MS wins over the config's cpuMs", () => {
  expect(edgeLimits(30_000, { RB_CPU_MS: "10" }).cpuMs).toBe(10);
  expect(edgeLimits(30_000, {}).cpuMs).toBe(30_000);
  expect(edgeLimits(undefined, {}).cpuMs).toBeUndefined();
});
