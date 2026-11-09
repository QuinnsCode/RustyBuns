import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { local, post } from "./app-kit.ts";
import type { Exec } from "../src/agent-run.ts";
import { sweepDexter } from "../src/dexter.ts";

const DAY = 24 * 3600 * 1000;
const until = async (f: () => Promise<boolean>) => { for (const end = performance.now() + 15_000; performance.now() < end && !(await f());) await Bun.sleep(20); };

/** claude as it prints stream-json: two turns, a big Read and a small Bash, then its result line. */
const STREAM = [
  { type: "system", subtype: "init", session_id: "s1" },
  { type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 },
    content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }, { type: "tool_use", id: "t2", name: "Bash", input: { command: "bun test" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(4000) }, { type: "tool_result", tool_use_id: "t2", content: "ok" }] } },
  { type: "assistant", message: { id: "m2", model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 1100, cache_creation_input_tokens: 0 }, content: [{ type: "text", text: "done" }] } },
  { type: "result", session_id: "s1", result: "done", usage: { input_tokens: 200, output_tokens: 50 } },
].map((l) => JSON.stringify(l)).join("\n");

test("the owner switches Dexter on: a hosted run's token use shows per tool, a trim lands on a branch to merge, off deletes it all (#3923)", async () => {
  const call = await local({ GH_CLI: "off" });
  call.env.AGENT_EXEC = (async (_cmd, cwd) => {
    writeFileSync(join(cwd, "a.js"), readFileSync(join(cwd, "a.js"), "utf8").toUpperCase());
    return { code: 0, out: STREAM };
  }) satisfies Exec;
  const put = (user: string, body: unknown) => call(user, "/api/repos/ryan/lab/dexter", { method: "PUT", body: JSON.stringify(body) });
  const state = async () => await (await call("ryan", "/api/repos/ryan/lab/dexter")).json() as any;
  for (const name of ["ryan", "sam"]) await post(call, name, "/api/login", { name });
  await post(call, "ryan", "/api/repos", { name: "lab" });
  await post(call, "ryan", "/api/repos/ryan/lab/collaborators", { name: "sam" });
  await post(call, "ryan", "/api/repos/ryan/lab/files", { path: "a.js", content: "let a = 1" });
  await post(call, "ryan", "/api/repos/ryan/lab/files", { path: "AGENTS.md", content: "# Lab\n\nIn order to ship, please run the tests.\n\n```sh\nin order to keep this\n```" });

  // Off by default, and only the owner switches him on.
  expect(await state()).toEqual({ on: false });
  expect((await put("sam", { on: true })).status).toBe(403);
  expect((await post(call, "sam", "/api/repos/ryan/lab/dexter/trims", {})).status).toBe(409);
  expect((await put("ryan", { on: true })).status).toBe(200);

  // A hosted run reports once, at its end: the numbers, never the text.
  await post(call, "ryan", "/api/repos/ryan/lab/agents", { path: "a.js", harness: "claude", task: "shout" });
  await until(async () => (await state()).week.runs === 1);
  const week = (await state()).week;
  expect(week).toMatchObject({ runs: 1, turns: 2, input: 200, output: 50, cacheRead: 2100, cacheWrite: 50 });
  expect(week.tools).toMatchObject([{ tool: "Read", calls: 1, tokens: 1000, worst: 1000, tip: expect.stringContaining("offset") }, { tool: "Bash", calls: 1, tokens: 1 }]);

  // The hourly sweep rolls the day up; a month on, the raw rows are gone and the rollup stays.
  await sweepDexter(call.env);
  expect((await state()).days).toMatchObject([{ runs: 1, turns: 2 }]);
  await sweepDexter(call.env, Date.now() + 31 * DAY);
  expect((await state()).week.runs).toBe(0);
  expect((await state()).days).toHaveLength(1);

  // The crew asks for trims: a diff, nothing written. Approving puts the cut on a branch; main is left for a person to merge.
  const asked = await (await post(call, "sam", "/api/repos/ryan/lab/dexter/trims", {})).json() as any;
  expect(asked.trims).toMatchObject([{ file: "AGENTS.md", status: "open", diff: "--- a/AGENTS.md\n+++ b/AGENTS.md\n@@ -3 +3 @@\n-In order to ship, please run the tests.\n+To ship, run the tests." }]);
  const id = asked.trims[0].id;
  const approved = await (await post(call, "sam", `/api/repos/ryan/lab/dexter/trims/${id}`, { approve: true })).json() as any;
  expect(approved.trims[0]).toMatchObject({ status: "approved", decided_by: "sam", branch: `dexter-trims-${id}` });
  const text = async (branch?: string) => ((await (await call("ryan", `/api/repos/ryan/lab/do/file?path=AGENTS.md${branch ? `&branch=${branch}` : ""}`)).json()) as any).lines.map((l: { text: string }) => l.text);
  expect((await text(`dexter-trims-${id}`))[2]).toBe("To ship, run the tests.");
  expect((await text())[2]).toBe("In order to ship, please run the tests.");
  expect((await post(call, "sam", `/api/repos/ryan/lab/dexter/trims/${id}`, { approve: true })).status).toBe(404);

  // Off deletes every row he kept for the repo.
  await put("ryan", { on: false });
  expect(await state()).toEqual({ on: false });
  const left = await call.env.DB.prepare("SELECT (SELECT COUNT(*) FROM dexter_runs) + (SELECT COUNT(*) FROM dexter_days) + (SELECT COUNT(*) FROM dexter_trims) AS n").first();
  expect(left.n).toBe(0);
});
