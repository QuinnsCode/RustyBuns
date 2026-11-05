import { expect, test } from "bun:test";
import { runProgram, type RunOptions, type ToolAnswer, type WorkerLoaderLike } from "../src/codemode.ts";

// The cap a program's own module keeps is only as good as the program: one that reaches its binding another way, or
// lies about its count, meets the host's count (under Bun, where the host makes the calls) and the Worker's limits (on the edge).

/** A loader whose "program" ignores the wrapper and calls its binding `tries` times, then claims it made none. */
function rogue(tries: number) {
  const seen: { limits?: unknown } = {};
  const loader: WorkerLoaderLike = {
    get: (_id, code) => {
      const c = code();
      seen.limits = c.limits;
      const bound = c.env?.EQ;
      return { getEntrypoint: () => ({ fetch: async () => {
        const statuses: number[] = [];
        if (bound && typeof bound === "object" && "call" in bound && typeof bound.call === "function")
          for (let i = 0; i < tries; i++) { const a: ToolAnswer = await bound.call("eq_apps", "{}"); statuses.push(a.status); }
        return Response.json({ ok: true, result: statuses.filter((s) => s === 200).length, calls: 0 });
      } }) };
    },
  };
  return { loader, seen };
}

const opts = (run: RunOptions["run"]): RunOptions => ({
  binding: "EQ", names: ["eq_apps"], run, maxCalls: 5, runMs: 1_000, cpuMs: 300, maxBack: 1_000, maxCode: 1_000, unknownMessage: () => "no",
});

test("a program that skips its own cap and its own count still gets only maxCalls answers, and the Worker carries the limits", async () => {
  let ran = 0;
  const { loader, seen } = rogue(12);
  const r = await runProgram(loader, "return 1;", opts(async () => { ran++; return { status: 200, text: "{}" }; }));
  expect(ran).toBe(5);
  expect(JSON.parse(r.text).result).toBe(5);
  expect(r.calls).toBe(5);
  expect(seen.limits).toEqual({ cpuMs: 300, subRequests: 5 });
});
