import { expect, setDefaultTimeout, test } from "bun:test";
import { edgeLike, recycling } from "../src/index.ts";

setDefaultTimeout(20_000);

test("RB_EDGE_RECYCLE sets the request count, default 100, 0 never", () => {
  expect(edgeLike({ RB_EDGE_LIKE: "1" })?.recycleAfter).toBe(100);
  expect(edgeLike({ RB_EDGE_LIKE: "1", RB_EDGE_RECYCLE: "5" })?.recycleAfter).toBe(5);
  expect(edgeLike({ RB_EDGE_LIKE: "1", RB_EDGE_RECYCLE: "0" })?.recycleAfter).toBe(0);
  expect(edgeLike({ RB_EDGE_RECYCLE: "5" })).toBeUndefined();
});

test("recycling restarts once, after the Nth answer", async () => {
  let restarts = 0;
  const f = recycling(2, () => { restarts++; }, async () => new Response("ok"));
  await f(); await new Promise((r) => setTimeout(r, 5));
  expect(restarts).toBe(0);
  await f(); await f(); await new Promise((r) => setTimeout(r, 5));
  expect(restarts).toBe(1);
});

test("edge-like host: a module-level counter resets after N requests, on the same port", async () => {
  const proc = Bun.spawn([process.execPath, `${import.meta.dir}/fixtures/recycle-host.ts`], {
    stdout: "pipe", stderr: "inherit", env: { ...process.env, RB_EDGE_LIKE: "1", RB_EDGE_RECYCLE: "3" },
  });
  let second = 0;
  try {
    const reader = proc.stdout.getReader();
    const { value } = await reader.read();
    const url = new TextDecoder().decode(value).match(/serving (\S+)/)![1];
    const hit = async () => (await (await fetch(url)).json()) as { hits: number; pid: number };
    const first = [await hit(), await hit(), await hit()];
    expect(first.map((h) => h.hits)).toEqual([1, 2, 3]);
    // the new process takes a moment to listen
    let after: { hits: number; pid: number } | undefined;
    for (let i = 0; i < 50 && !after; i++) {
      try { const h = await hit(); if (h.pid !== first[0].pid) after = h; } catch { await Bun.sleep(100); }
    }
    expect(after?.hits).toBe(1);
    second = after!.pid;
  } finally {
    proc.kill();
    if (second) try { process.kill(second); } catch {}
  }
});
