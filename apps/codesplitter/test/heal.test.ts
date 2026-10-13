import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { local as boot } from "../src/local.ts";
import type { Exec } from "../src/agent-run.ts";
import { alsoFor, blame, healUnavailable, MAX_ALSO, MAX_ATTEMPTS } from "../src/heal.ts";

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

test("the same failure twice: the next fix task starts from a note saying what was tried, or a person gets it (#1077)", async () => {
  const { fail, runs, settled, prompts } = await app();
  for (const c of ["a", "b"]) { await fail(sha(c)); await until(async () => (await runs()).length > (c === "a" ? 0 : 1)); await settled(); }
  const [second, first] = await runs();
  expect(second.task).toStartWith(`DONE: fix task ${first.id} edited a.ts\nBROKE: same failure after it\nDONT: that fix again; find the real cause\nTASK: Fix the failing check`);
  expect(prompts[1]).toContain("DONT: that fix again");

  const p = await app();
  await p.send("ryan", "/api/repos/ryan/lab/files", { path: ".gitattributes", content: "a.ts codesplitter-over=escalate" });
  for (const c of ["a", "b"]) { await p.fail(sha(c)); await p.settled(); }
  expect((await p.runs()).length).toBe(1);
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

test("a fix task rides the FIXES queue, not JOBS, so it doesn't wait behind feature runs (#1234)", async () => {
  const { call, fail, runs, settled } = await app();
  const sent: Record<string, unknown[]> = { JOBS: [], FIXES: [] };
  for (const q of ["JOBS", "FIXES"] as const) {
    const send = call.env[q].send.bind(call.env[q]);
    call.env[q].send = (body: unknown, opts?: unknown) => { sent[q]!.push(body); return send(body, opts); };
  }
  await fail(sha("a"));
  await until(async () => (await runs()).length > 0);
  await settled();
  const [run] = await runs();
  expect(run).toMatchObject({ status: "done", applied: 1 });
  expect(sent.FIXES).toEqual([{ agent: run.id, origin: "http://codesplitter.local" }]);
  expect(sent.JOBS).toEqual([]);
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

test("a fix task gets the branch's other changed files too, and can fix a test and its code in one go (#1037)", async () => {
  const { call, send, fail, runs, settled, file, prompts } = await app();
  await send("ryan", "/api/repos/ryan/lab/files", { path: "a.test.ts", content: "expect(one)" });
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=a.test.ts", { message: "its test" });
  const t = (await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.test.ts&branch=tidy")).json() as { lines: { id: string; rev: number }[] }).lines;
  await send("ryan", "/api/repos/ryan/lab/do/ops?path=a.test.ts&branch=tidy", { ops: [{ kind: "set", line: t[0]!.id, text: "expect(ONE)", base: t[0]!.rev }] });
  const seen: string[][] = [];
  const lower = call.env.AGENT_EXEC as Exec;
  call.env.AGENT_EXEC = (async (cmd, cwd) => {
    seen.push(["a.ts", "a.test.ts"].filter((p) => existsSync(join(cwd, p))));
    writeFileSync(join(cwd, "a.test.ts"), "expect(two)\n");
    return lower(cmd, cwd);
  }) as Exec;
  await fail(sha("a"));
  await until(async () => (await runs()).length > 0);
  await settled();
  const [run] = await runs();
  expect(run).toMatchObject({ path: "a.ts", status: "done", also: ["a.test.ts"], edited: ["a.test.ts"], applied: 2 });
  expect(seen[0]).toEqual(["a.ts", "a.test.ts"]);
  expect(run.task).toContain("The branch also changes a.test.ts; they're in front of you too.");
  expect(prompts[0]).toContain("You are editing a.ts, and may edit a.test.ts too");
  expect((await file("tidy")).map((l) => l.text)).toEqual(["one", "two"]);
  const b = (await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.test.ts&branch=tidy")).json() as { lines: { text: string; by: string }[] }).lines;
  expect(b.map((l) => [l.text, l.by])).toEqual([["expect(two)", "agent-claude"]]);
});

test("blame: the file the log names most; alsoFor: the rest, those it names first", () => {
  expect(blame(["a.ts", "b.ts"], "b.ts:3 x\nb.ts:4 y\na.ts:1")).toBe("b.ts");
  expect(blame(["a.ts", "b.ts"], "nothing")).toBe("a.ts");
  expect(alsoFor(["a.ts", "b.ts", "c.ts"], "a.ts", "c.ts:1")).toEqual(["c.ts", "b.ts"]);
  expect(alsoFor(Array.from({ length: MAX_ALSO + 5 }, (_, i) => `f${i}.ts`), "f0.ts").length).toBe(MAX_ALSO);
});
