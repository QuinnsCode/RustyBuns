import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalWorkflow, durationMs, type WorkflowEvent, type WorkflowStep } from "../src/bindings/workflow.ts";
import { NonRetryableError } from "../src/shims.ts";

const quiet = <T>(fn: () => Promise<T>) => { const e = console.error; console.error = () => {}; return fn().finally(() => { console.error = e; }); };

test("durations read as the edge writes them", () => {
  expect(durationMs(250)).toBe(250);
  expect(durationMs("5 seconds")).toBe(5000);
  expect(durationMs("1 minute")).toBe(60_000);
  expect(durationMs("2 days")).toBe(2 * 864e5);
  expect(() => durationMs("soon")).toThrow(/duration/);
});

test("create before bind queues; bind runs it; status has the output and steps run once", async () => {
  const ran: string[] = [];
  class Flow { constructor(_c: unknown, readonly env: { n: number }) {}
    async run(e: WorkflowEvent<{ x: number }>, step: WorkflowStep) {
      const a = await step.do("a", () => { ran.push("a"); return e.payload.x + this.env.n; });
      const b = await step.do("b", async () => { ran.push("b"); return a * 2; });
      return { a, b, id: e.instanceId };
    }
  }
  const wf = new LocalWorkflow<{ x: number }, { n: number }>(":memory:", "FLOW");
  const inst = await wf.create({ id: "one", params: { x: 1 } });
  expect((await inst.status()).status).toBe("queued");
  wf.bind(Flow, { n: 10 });
  await wf.settled("one");
  expect(await inst.status()).toEqual({ status: "complete", output: { a: 11, b: 22, id: "one" } });
  expect(ran).toEqual(["a", "b"]);
  await expect(wf.create({ id: "one" })).rejects.toThrow(/already exists/);
  expect((await (await wf.get("one")).status()).status).toBe("complete");
  await expect(wf.get("nope")).rejects.toThrow(/no instance/);
});

test("retries, then a NonRetryableError fails the instance at once", async () => {
  let tries = 0, hard = 0;
  class Flow { async run(_e: unknown, step: WorkflowStep) {
    await step.do("flaky", { retries: { limit: 3, delay: 1, backoff: "constant" } }, () => { if (++tries < 3) throw new Error("not yet"); return "ok"; });
    await step.do("hard", { retries: { limit: 5, delay: 1 } }, () => { hard++; throw new NonRetryableError("no"); });
  } }
  const wf = new LocalWorkflow(":memory:", "FLOW").bind(Flow as any, {});
  await quiet(async () => { await wf.create({ id: "r" }); await wf.settled("r"); });
  expect(tries).toBe(3);
  expect(hard).toBe(1);
  expect(await (await wf.get("r")).status()).toEqual({ status: "errored", error: { name: "NonRetryableError", message: "no" } });
});

test("a run cut off by a restart of the process picks up: done steps aren't redone, a sleep keeps its deadline", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "rb-wf-")), "wf.sqlite");
  const ran: string[] = [];
  class Flow { async run(_e: unknown, step: WorkflowStep) {
    await step.do("first", () => { ran.push("first"); });
    await step.sleep("nap", 80);
    await step.do("second", () => { ran.push("second"); });
    return "done";
  } }
  const one = new LocalWorkflow(path, "FLOW").bind(Flow as any, {});
  const inst = await one.create({ id: "p" });
  await Bun.sleep(20);
  expect((await inst.status()).status).toBe("waiting");
  // A second process over the same file: the first one's sleeping run is what died with it.
  const two = new LocalWorkflow(path, "FLOW").bind(Flow as any, {});
  const t0 = Date.now();
  await two.settled("p");
  expect(Date.now() - t0).toBeLessThan(80);
  expect((await (await two.get("p")).status()).output).toBe("done");
  await one.settled("p");
  expect(ran.filter((r) => r === "first").length).toBe(1);
});

test("waitForEvent takes an event sent before or during the wait, and times out", async () => {
  class Flow { async run(_e: unknown, step: WorkflowStep) {
    const a = await step.waitForEvent<{ ok: boolean }>("approve", { type: "approval" });
    const b = await step.waitForEvent("again", { type: "approval", timeout: 2000 });
    return [a.payload, b.payload];
  } }
  const wf = new LocalWorkflow(":memory:", "FLOW").bind(Flow as any, {});
  const inst = await wf.create({ id: "w" });
  await inst.sendEvent({ type: "approval", payload: { ok: true } });
  await Bun.sleep(10);
  expect((await inst.status()).status).toBe("waiting");
  await inst.sendEvent({ type: "approval", payload: 2 });
  await wf.settled("w");
  expect((await inst.status()).output).toEqual([{ ok: true }, 2]);

  class Late { async run(_e: unknown, step: WorkflowStep) { await step.waitForEvent("x", { type: "never", timeout: 20 }); } }
  const late = new LocalWorkflow(":memory:", "LATE").bind(Late as any, {});
  await quiet(async () => { await late.create({ id: "l" }); await late.settled("l"); });
  expect((await (await late.get("l")).status()).error?.message).toMatch(/timed out/);
});

test("pause holds the next step; resume, terminate and restart", async () => {
  const ran: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  class Flow { async run(_e: unknown, step: WorkflowStep) {
    await step.do("a", async () => { ran.push("a"); await gate; });
    await step.do("b", () => { ran.push("b"); });
  } }
  const wf = new LocalWorkflow(":memory:", "FLOW").bind(Flow as any, {});
  const inst = await wf.create({ id: "x" });
  await Bun.sleep(5);
  await inst.pause();
  release();
  await Bun.sleep(10);
  expect(ran).toEqual(["a"]);
  expect((await inst.status()).status).toBe("paused");
  await inst.resume();
  await wf.settled("x");
  expect(ran).toEqual(["a", "b"]);
  expect((await inst.status()).status).toBe("complete");
  await expect(inst.terminate()).rejects.toThrow(/can't be terminated/);

  await inst.restart();
  await wf.settled("x");
  expect(ran).toEqual(["a", "b", "a", "b"]);

  class Slow { async run(_e: unknown, step: WorkflowStep) { await step.sleep("long", "1 hour"); ran.push("woke"); } }
  const slow = new LocalWorkflow(":memory:", "SLOW").bind(Slow as any, {});
  const s = await slow.create({ id: "s" });
  await Bun.sleep(5);
  await s.terminate();
  expect((await s.status()).status).toBe("terminated");
  expect(ran).not.toContain("woke");
});
