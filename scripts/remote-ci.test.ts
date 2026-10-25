import { expect, test } from "bun:test";
import { parseJobs, pool } from "./remote-ci.ts";

test("reads the touched suites and skips apps with no test command", () => {
  const out = `apps=${JSON.stringify({ include: [{ app: "a", test: "bun test", prep: "" }, { app: "b", test: "", prep: "" }] })}\nany=true\n`;
  expect(parseJobs(out).map((j) => j.app)).toEqual(["a"]);
  expect(() => parseJobs("any=false")).toThrow();
});

test("the pool never runs more than the cap and returns the worst code", async () => {
  let live = 0, peak = 0;
  const worst = await pool([0, 1, 0, 2, 0, 0], 2, async (code) => {
    peak = Math.max(peak, ++live);
    await Bun.sleep(5);
    live--;
    return code;
  });
  expect(worst).toBe(2);
  expect(peak).toBe(2);
});
