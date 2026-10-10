import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { local as boot } from "../src/local.ts";
import type { Exec } from "../src/agent-run.ts";

// These run the app end to end (real git, password hashes, in-process D1): fine alone,
// but a full run on a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

/** The app with a fake CLI that upper-cases the file it is given. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const exec: Exec = async (cmd, cwd) => {
    const f = join(cwd, existsSync(join(cwd, "a.js")) ? "a.js" : "src/deep/b.js");
    writeFileSync(f, readFileSync(f, "utf8").toUpperCase());
    return { code: 0, out: `${cmd.bin} done` };
  };
  call.env.AGENT_EXEC = exec;
  const post = (user: string | null, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
  await post("ryan", "/api/login", { name: "ryan" });
  await post("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await post("ryan", "/api/repos/ryan/lab/files", { path: "a.js", content: "let a = 1\nlet b = 2" });
  return { call, post };
}

const until = async (f: () => Promise<boolean>) => { for (const end = performance.now() + 15_000; performance.now() < end && !(await f());) await Bun.sleep(20); };

test("the owner gives an agent a task; its edit lands on the file, blamed on the agent", async () => {
  const { call, post } = await app();
  expect(await (await call(null, "/api/agents")).json()).toMatchObject({ available: true, harnesses: ["claude", "codex", "pi", "opencode"] });

  const res = await post("ryan", "/api/repos/ryan/lab/agents", { path: "a.js", harness: "claude", task: "shout" });
  expect(res.status).toBe(202);
  expect(await res.json()).toMatchObject({ agent: "agent-claude", status: "running" });

  let runs: any[] = [];
  await until(async () => (runs = await (await call("ryan", "/api/repos/ryan/lab/agents?path=a.js")).json())[0].status !== "running");
  expect(runs[0]).toMatchObject({ status: "done", applied: 2, conflicts: [], output: "claude done" });

  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.js")).json() as { lines: { text: string; by: string }[] };
  expect(doc.lines.map((l) => [l.text, l.by])).toEqual([["LET A = 1", "agent-claude"], ["LET B = 2", "agent-claude"]]);
  const repo = await (await call("ryan", "/api/repos/ryan/lab")).json() as { collaborators: string[] };
  expect(repo.collaborators).toContain("agent-claude");
});

test("a file in a folder works too", async () => {
  const { call, post } = await app();
  await post("ryan", "/api/repos/ryan/lab/files", { path: "src/deep/b.js", content: "x" });
  await post("ryan", "/api/repos/ryan/lab/agents", { path: "src/deep/b.js", harness: "pi", task: "shout" });
  let runs: any[] = [];
  await until(async () => (runs = await (await call("ryan", "/api/repos/ryan/lab/agents?path=src%2Fdeep%2Fb.js")).json())[0].status !== "running");
  expect(runs[0]).toMatchObject({ status: "done", applied: 1 });
});

test("only the owner may start one or see the runs; strangers to a private repo see nothing", async () => {
  const { call, post } = await app();
  await post("ryan", "/api/repos/ryan/lab/collaborators", { name: "sam" });
  expect((await post("sam", "/api/repos/ryan/lab/agents", { path: "a.js", harness: "codex", task: "x" })).status).toBe(403);
  expect((await post(null, "/api/repos/ryan/lab/agents", { path: "a.js", harness: "codex", task: "x" })).status).toBe(403);
  expect((await call("sam", "/api/repos/ryan/lab/agents?path=a.js")).status).toBe(403);
  expect((await call(null, "/api/repos/ryan/lab/agents?path=a.js")).status).toBe(403);
  expect((await call("ryan", "/api/repos/ryan/lab/agents?path=a.js")).status).toBe(200);

  await call("ryan", "/api/repos/ryan/lab", { method: "PUT", body: JSON.stringify({ visibility: "private" }) });
  expect((await call("eve", "/api/repos/ryan/lab/agents?path=a.js")).status).toBe(404);
});

test("a bad harness or an empty task is refused", async () => {
  const { post } = await app();
  expect((await post("ryan", "/api/repos/ryan/lab/agents", { path: "a.js", harness: "vim", task: "x" })).status).toBe(400);
  expect((await post("ryan", "/api/repos/ryan/lab/agents", { path: "a.js", harness: "pi", task: "  " })).status).toBe(400);
});
