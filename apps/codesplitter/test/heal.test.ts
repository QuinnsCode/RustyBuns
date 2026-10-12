import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { local as boot } from "../src/local.ts";
import type { Exec } from "../src/agent-run.ts";
import { blame, healUnavailable, MAX_ATTEMPTS } from "../src/heal.ts";

// End to end, with real git and the in-process queue: a full run on a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const sha = (c: string) => c.repeat(40);
const until = async (f: () => Promise<boolean>) => { for (const end = performance.now() + 15_000; performance.now() < end && !(await f());) await Bun.sleep(20); };

/** The app with self-healing on (HEAL=1) or not, a fake CLI that drops git's markers and lower-cases a.ts, and a branch `tidy` that shouts its first line. */
async function app(heal = true) {
  const call = await boot({ GH_CLI: "off", ...(heal && { HEAL: "1" }) });
  opened.push(call);
  const prompts: string[] = [];
  call.env.AGENT_EXEC = (async (cmd, cwd) => {
    prompts.push(cmd.args.join(" "));
    const f = join(cwd, "a.ts");
    writeFileSync(f, readFileSync(f, "utf8").split("\n").filter((l) => !/^(<{7}|={7}|>{7})/.test(l)).join("\n").toLowerCase());
    return { code: 0, out: "fixed" };
  }) as Exec;
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=a.ts", { message: "first" });
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "tidy" });
  const file = async (branch?: string) => (await (await call("ryan", `/api/repos/ryan/lab/do/file?path=a.ts${branch ? `&branch=${branch}` : ""}`)).json() as { lines: { id: string; rev: number; text: string; by: string }[] }).lines;
  const doc = await file("tidy");
  await send("ryan", "/api/repos/ryan/lab/do/ops?path=a.ts&branch=tidy", { ops: [{ kind: "set", line: doc[0]!.id, text: "ONE", base: doc[0]!.rev }] });
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { required: ["test"] }, "PUT");
  /** `test` fails on tidy at `at`, its log naming the file. */
  const fail = async (at: string) => {
    const run = await (await send("ryan", "/api/repos/ryan/lab/checks", { ref: "tidy", sha: at, name: "test" })).json() as { id: number };
    await send("ryan", `/api/repos/ryan/lab/checks/${run.id}`, { status: "failed", append: "a.ts:1 expected one, got ONE\n1 fail\n" }, "PUT");
  };
  const runs = async () => (await (await call("ryan", "/api/repos/ryan/lab/agents")).json()) as any[];
  const settled = () => until(async () => (await runs()).every((r) => r.status !== "running"));
  const checks = async () => (await (await call("ryan", "/api/repos/ryan/lab/checks?ref=tidy")).json()) as any;
  return { call, send, file, fail, runs, settled, checks, prompts };
}

test("a required check failing on a branch opens a fix task there; it edits the branch, not main", async () => {
  const { fail, runs, settled, file, checks, prompts } = await app();
  await fail(sha("a"));
  await until(async () => (await runs()).length > 0);
  await settled();
  const [run] = await runs();
  expect(run).toMatchObject({ branch: "tidy", path: "a.ts", status: "done", applied: 1, agent: "agent-claude" });
  expect(run.pending).toBeUndefined();
  expect(run.task).toContain(`Fix the failing check "test" on branch tidy`);
  expect(prompts[0]).toContain("expected one, got ONE");
  expect((await file("tidy")).map((l) => [l.text, l.by])).toEqual([["one", "agent-claude"], ["two", "ryan"]]);
  expect((await file()).map((l) => l.text)).toEqual(["one", "two"]);
  // The branch changed, so the gate waits on its checks again, and the attempt shows.
  const c = await checks();
  expect(c.stale).toBe(true);
  expect(c.heal).toMatchObject({ max: MAX_ATTEMPTS, running: false, gave_up: false, attempts: [{ id: run.id, status: "done", applied: 1 }] });
});

test(`after ${MAX_ATTEMPTS} fix tasks the branch waits for a person, with the attempts attached`, async () => {
  const { send, fail, runs, settled, checks } = await app();
  for (const c of ["a", "b", "c"]) { await fail(sha(c)); await settled(); }
  expect((await runs()).length).toBe(MAX_ATTEMPTS);
  const c = await checks();
  expect(c.heal).toMatchObject({ gave_up: true });
  expect(c.heal.attempts.length).toBe(MAX_ATTEMPTS);
  const m = await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {});
  expect(m.status).toBe(409);
  const why = await m.json() as any;
  expect(why.error).toContain(`Self-healing gave up after ${MAX_ATTEMPTS} fix tasks: it waits for a person`);
  expect(why.heal.attempts.length).toBe(MAX_ATTEMPTS);
});

test("two failures at once open one fix task", async () => {
  const { send, runs, settled } = await app();
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { required: ["test", "lint"] }, "PUT");
  await Promise.all(["test", "lint"].map(async (name) => {
    const run = await (await send("ryan", "/api/repos/ryan/lab/checks", { ref: "tidy", sha: sha("a"), name })).json() as { id: number };
    await send("ryan", `/api/repos/ryan/lab/checks/${run.id}`, { status: "failed" }, "PUT");
  }));
  await settled();
  expect((await runs()).length).toBe(1);
});

test("off unless hosted agents are on or the desktop says HEAL=1; a check that isn't required opens nothing", async () => {
  const off = await app(false);
  await off.fail(sha("a"));
  await Bun.sleep(100);
  expect(await off.runs()).toEqual([]);

  const on = await app();
  await on.send("ryan", "/api/repos/ryan/lab/checks/settings", { required: ["lint"] }, "PUT");
  await on.fail(sha("a"));
  await Bun.sleep(100);
  expect(await on.runs()).toEqual([]);

  expect(healUnavailable({ HEAL: "off", AGENT_SANDBOX: {} } as never, "ryan")).toContain("HEAL=off");
  expect(healUnavailable({} as never, "ryan")).toContain("HEAL=1");
});

test("a merge guard tripping (git's markers on the branch) opens a fix task, and then it merges", async () => {
  const { send, file, runs, settled, prompts } = await app();
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { required: [] }, "PUT");
  const doc = await file("tidy");
  await send("ryan", "/api/repos/ryan/lab/do/ops?path=a.ts&branch=tidy", { ops: [{ kind: "insert", after: doc[1]!.id, text: "<<<<<<< HEAD" }] });
  const m = await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {});
  expect(m.status).toBe(409);
  const body = await m.json() as any;
  expect(typeof body.fix).toBe("number");
  await settled();
  expect((await runs())[0]).toMatchObject({ id: body.fix, branch: "tidy", status: "done" });
  expect(prompts[0]).toContain("git's conflict markers");
  expect((await file("tidy")).map((l) => l.text)).toEqual(["one", "two"]);
  expect((await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {})).status).toBe(200);
});

test("blame: the file the log names most", () => {
  expect(blame(["a.ts", "b.ts"], "b.ts:3 x\nb.ts:4 y\na.ts:1")).toBe("b.ts");
  expect(blame(["a.ts", "b.ts"], "nothing")).toBe("a.ts");
});
