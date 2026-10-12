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
  // A batch waits a moment on main before it lands; a test that reviews one sets a longer wait.
  call.env.AGENT_REVIEW_MS = "200";
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
  const started = await res.json() as any;
  expect(started).toMatchObject({ agent: "agent-claude", status: "running" });
  expect(started.deadline).toBeUndefined(); // the desktop has no limit: its clock counts up

  let runs: any[] = [];
  await until(async () => (runs = await (await call("ryan", "/api/repos/ryan/lab/agents?path=a.js")).json())[0].status !== "running");
  expect(runs[0]).toMatchObject({ status: "done", applied: 2, conflicts: [], output: "claude done", pending: { branch: `agent-run-${started.id}` } });

  // Nobody stopped the clock: it lands on main by itself.
  await until(async () => !!(runs = await (await call("ryan", "/api/repos/ryan/lab/agents?path=a.js")).json())[0].landed);
  expect(runs[0]).toMatchObject({ landed: { by: "auto" } });
  expect(runs[0].pending).toBeUndefined();
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

test("a desktop run cut off when the app quit shows as failed, not running for ever", async () => {
  const { call } = await app();
  await call.env.DB.prepare("INSERT INTO agent_runs (owner, repo, path, harness, task, agent, status, started, picked) VALUES ('ryan', 'lab', 'a.js', 'claude', 'x', 'agent-claude', 'running', 1, 1)").run();
  const runs = await (await call("ryan", "/api/repos/ryan/lab/agents")).json() as any[];
  expect(runs[0]).toMatchObject({ status: "failed", error: "the app stopped before the agent finished" });
});

/** A CLI that waits: till Stop kills it (signal), or till `go` lets it upper-case the file. Each run's prompt is kept. */
function gated(call: { env: any }) {
  const prompts: string[] = [];
  let go = () => {};
  call.env.AGENT_EXEC = (async (cmd, cwd, signal) => {
    const gate = new Promise<void>((done, fail) => { go = done; signal?.addEventListener("abort", () => fail(new Error("killed"))); });
    prompts.push(cmd.args.join(" "));
    await gate;
    const f = join(cwd, "a.js");
    writeFileSync(f, readFileSync(f, "utf8").toUpperCase());
    return { code: 0, out: "done\nDONE: shouted a\nNEXT: shout b (a.js:2)" };
  }) as Exec;
  /** Waits for its `n`th run to start. */
  const started = (n: number) => until(async () => prompts.length >= n);
  return { prompts, go: () => go(), started };
}

const runsOf = async (call: any) => (await (await call("ryan", "/api/repos/ryan/lab/agents?path=a.js")).json()) as any[];

test("Stop kills a running agent: nothing it left lands, its claim is lifted, and it shows as stopped", async () => {
  const { call, post } = await app();
  const cli = gated(call);
  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.js")).json() as { lines: { id: string }[] };
  const run = await (await post("ryan", "/api/repos/ryan/lab/agents", { path: "a.js", harness: "claude", task: "shout", lines: [doc.lines[0]!.id] })).json() as any;
  await cli.started(1);
  await until(async () => ((await (await call("ryan", "/api/repos/ryan/lab/do/claims?path=a.js")).json()) as unknown[]).length > 0);

  expect((await post("sam", "/api/repos/ryan/lab/agents/stop", { ids: [run.id] })).status).toBe(403);
  expect(await (await post("ryan", "/api/repos/ryan/lab/agents/stop", { ids: [run.id] })).json()).toEqual({ stopped: [run.id] });
  await until(async () => (await runsOf(call))[0].error !== undefined);
  expect((await runsOf(call))[0]).toMatchObject({ status: "stopped", error: "stopped by @ryan" });
  expect(await (await call("ryan", "/api/repos/ryan/lab/do/claims?path=a.js")).json()).toEqual([]);
  cli.go(); // too late: it was killed
  await Bun.sleep(50);
  const after = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.js")).json() as { lines: { text: string }[] };
  expect(after.lines.map((l) => l.text)).toEqual(["let a = 1", "let b = 2"]);
  // Stopping it again stops nothing.
  expect(await (await post("ryan", "/api/repos/ryan/lab/agents/stop", { ids: [run.id] })).json()).toEqual({ stopped: [] });
});

test("a note to a running agent goes into its next run's prompt: it goes round again when this run ends", async () => {
  const { call, post } = await app();
  const cli = gated(call);
  const run = await (await post("ryan", "/api/repos/ryan/lab/agents", { path: "a.js", harness: "codex", task: "shout" })).json() as any;
  await cli.started(1);
  expect((await post("ryan", `/api/repos/ryan/lab/agents/${run.id}/notes`, { text: " " })).status).toBe(400);
  expect((await post("sam", `/api/repos/ryan/lab/agents/${run.id}/notes`, { text: "x" })).status).toBe(403);
  const told = await (await post("ryan", `/api/repos/ryan/lab/agents/${run.id}/notes`, { text: "leave b alone" })).json() as any;
  expect(told.notes).toMatchObject([{ text: "leave b alone" }]);
  expect(cli.prompts[0]).not.toContain("leave b alone");

  cli.go();
  await cli.started(2);
  expect(cli.prompts[1]).toContain("told you:\n- leave b alone");
  cli.go();
  await until(async () => (await runsOf(call))[0].status !== "running");
  expect((await runsOf(call))[0]).toMatchObject({ status: "done", runs: 2, notes: [{ text: "leave b alone" }] });
  // A finished run takes no notes.
  expect((await post("ryan", `/api/repos/ryan/lab/agents/${run.id}/notes`, { text: "x" })).status).toBe(409);
  expect((await post("ryan", "/api/repos/ryan/lab/agents/999/notes", { text: "x" })).status).toBe(404);
});

/** A run on a.js under a 10-token budget that a note sends round again, so it trips before its second go. */
async function overBudget(over: string) {
  const { call, post } = await app();
  await post("ryan", "/api/repos/ryan/lab/files", { path: ".gitattributes", content: `a.js codesplitter-budget=10 codesplitter-over=${over}` });
  const cli = gated(call);
  const run = await (await post("ryan", "/api/repos/ryan/lab/agents", { path: "a.js", harness: "codex", task: "shout every line" })).json() as any;
  await cli.started(1);
  await post("ryan", `/api/repos/ryan/lab/agents/${run.id}/notes`, { text: "and b" });
  cli.go();
  await until(async () => (await runsOf(call)).find((r) => r.id === run.id).status !== "running");
  return { call, cli, run };
}

test("past its path's budget a run hands off: a fresh agent starts from its terse note alone, on its branch, and the batch lands after (#1077)", async () => {
  const { call, cli, run } = await overBudget("handoff");
  const first = (await runsOf(call)).find((r) => r.id === run.id);
  expect(first).toMatchObject({ status: "done", runs: 1, applied: 2, handoff: { why: "context past 10 tokens", over: "handoff" }, pending: { until: null } });
  expect(first.spent).toBeGreaterThan(10);
  expect(first.handoff.note).toBe("DONE: shouted a\nNEXT: shout b (a.js:2)\nBROKE: context past 10 tokens");
  expect(cli.prompts[0]).toContain("caveman-terse");
  await cli.started(2);
  // The fresh one gets the note and nothing else: not the old task, not the notes.
  expect(cli.prompts[1]).toContain("Fresh eyes on a.js: the last agent stopped (context past 10 tokens)");
  expect(cli.prompts[1]).toContain("NEXT: shout b (a.js:2)");
  expect(cli.prompts[1]).not.toContain("and b");
  const next = (await runsOf(call)).find((r) => r.id === first.handoff.next);
  expect(next).toMatchObject({ from: run.id, hops: 1, branch: `agent-run-${run.id}` });
  cli.go();
  await until(async () => !!(await runsOf(call)).find((r) => r.id === run.id).landed);
  expect((await runsOf(call)).find((r) => r.id === run.id)).toMatchObject({ landed: { by: "auto" } });
});

test("a path whose policy escalates waits for a person instead, its note attached", async () => {
  const { call, cli, run } = await overBudget("escalate");
  const first = (await runsOf(call)).find((r) => r.id === run.id);
  expect(first).toMatchObject({ handoff: { over: "escalate" }, pending: { until: null } });
  expect(first.handoff.next).toBeUndefined();
  expect(first.pending.why).toContain("(context past 10 tokens): a person's turn");
  expect(cli.prompts.length).toBe(1);
  expect((await runsOf(call)).length).toBe(1);
});

test("bulk Stop: by harness, by the lines they claimed, or all of them", async () => {
  const { call, post } = await app();
  call.env.AGENT_EXEC = (async (_cmd, _cwd, signal) => new Promise((_, fail) => signal?.addEventListener("abort", () => fail(new Error("killed"))))) as Exec;
  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.js")).json() as { lines: { id: string }[] };
  const [a, b] = doc.lines.map((l) => l.id);
  const start = async (harness: string, lines?: string[]) => (await (await post("ryan", "/api/repos/ryan/lab/agents", { path: "a.js", harness, task: "x", lines })).json() as any).id as number;
  const c1 = await start("claude", [a!]), c2 = await start("claude", [b!]), p1 = await start("pi"), p2 = await start("pi");

  expect(await (await post("ryan", "/api/repos/ryan/lab/agents/stop", { lines: [a] })).json()).toEqual({ stopped: [c1] });
  expect(((await (await post("ryan", "/api/repos/ryan/lab/agents/stop", { harness: "pi" })).json()) as any).stopped.sort()).toEqual([p1, p2].sort());
  expect(await (await post("ryan", "/api/repos/ryan/lab/agents/stop", {})).json()).toEqual({ stopped: [c2] });
  await until(async () => (await runsOf(call)).every((r) => r.status === "stopped" && !live(r)));
  expect((await runsOf(call)).map((r) => r.status)).toEqual(["stopped", "stopped", "stopped", "stopped"]);
});
/** Whether a run's own write-up hasn't landed yet (it keeps the error the Stop wrote). */
const live = (r: any) => r.error === undefined;

/** Starts a run on a.js with a long wait, and waits for its batch to be waiting on main. */
async function waiting(call: any, post: any) {
  call.env.AGENT_REVIEW_MS = "60000";
  const id = (await (await post("ryan", "/api/repos/ryan/lab/agents", { path: "a.js", harness: "claude", task: "shout" })).json() as any).id as number;
  await until(async () => (await runsOf(call)).find((r) => r.id === id)?.status !== "running");
  return { id, run: (await runsOf(call)).find((r) => r.id === id) };
}
const mainText = async (call: any) => ((await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.js")).json()) as { lines: { text: string }[] }).lines.map((l) => l.text);

test("a batch waits on main as its own branch's hunks: hold stops the clock, a look puts it off, accept lands it", async () => {
  const { call, post } = await app();
  const { id, run } = await waiting(call, post);
  expect(run.status).toBe("done");
  expect(run.pending.until).toBeGreaterThan(Date.now() + 30_000);
  expect(await mainText(call)).toEqual(["let a = 1", "let b = 2"]);
  const { hunks } = await (await call("ryan", `/api/repos/ryan/lab/branches/agent-run-${id}/hunks?path=a.js`)).json() as any;
  expect(hunks.map((h: any) => h.add.map((l: any) => l.text))).toEqual([["LET A = 1", "LET B = 2"]]);

  expect((await post("sam", `/api/repos/ryan/lab/agents/${id}/accept`, {})).status).toBe(403);
  const looked = await (await post("ryan", `/api/repos/ryan/lab/agents/${id}/look`, {})).json() as any;
  expect(looked.pending.until).toBe(run.pending.until); // already further off than a look puts it
  expect((await (await post("ryan", `/api/repos/ryan/lab/agents/${id}/hold`, {})).json() as any).pending.until).toBeNull();
  expect((await (await post("ryan", `/api/repos/ryan/lab/agents/${id}/look`, {})).json() as any).pending.until).toBeNull(); // held stays held

  // Someone changes line 2 on main meanwhile: theirs stays, and the run says what the agent wanted.
  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.js")).json() as { lines: { id: string; rev: number }[] };
  await post("ryan", "/api/repos/ryan/lab/do/ops?path=a.js", { ops: [{ kind: "set", line: doc.lines[1]!.id, base: doc.lines[1]!.rev, text: "const b = 2" }] });
  expect(await (await post("ryan", `/api/repos/ryan/lab/agents/${id}/accept`, {})).json()).toMatchObject({ landed: true });
  expect(await mainText(call)).toEqual(["LET A = 1", "const b = 2"]);
  const after = (await runsOf(call)).find((r) => r.id === id);
  expect(after).toMatchObject({ landed: { by: "ryan" }, kept: [{ line: doc.lines[1]!.id, yours: "const b = 2", wanted: "LET B = 2" }] });
  expect(after.pending).toBeUndefined();
  expect((await post("ryan", `/api/repos/ryan/lab/agents/${id}/accept`, {})).status).toBe(409);
});

test("the crew see a waiting batch and can look at or hold it; landing and binning it stay the owner's", async () => {
  const { call, post } = await app();
  await post("sam", "/api/login", { name: "sam" });
  await post("ryan", "/api/repos/ryan/lab/collaborators", { name: "sam" });
  const { id, run } = await waiting(call, post);
  type W = { waiting: { id: number; agent: string; pending: { until: number | null }; hunks: { add: { text: string }[] }[] }[]; kept: unknown[] };
  const seen = await (await call("sam", "/api/repos/ryan/lab/agents/waiting?path=a.js")).json() as W;
  expect(seen.waiting).toMatchObject([{ id, agent: run.agent, pending: { until: run.pending.until } }]);
  expect(seen.waiting[0]!.hunks.map((h) => h.add.map((l) => l.text))).toEqual([["LET A = 1", "LET B = 2"]]);
  expect(seen.waiting[0]).not.toHaveProperty("task");
  // Anyone who reads a public repo sees it too, but can't put it off.
  expect((await (await call(null, "/api/repos/ryan/lab/agents/waiting?path=a.js")).json() as W).waiting.map((w) => w.id)).toEqual([id]);
  expect((await post(null, `/api/repos/ryan/lab/agents/${id}/look`, {})).status).toBe(403);
  expect((await post("eve", `/api/repos/ryan/lab/agents/${id}/hold`, {})).status).toBe(403);
  expect((await call("sam", "/api/repos/ryan/lab/agents/waiting")).status).toBe(400);

  expect((await post("sam", `/api/repos/ryan/lab/agents/${id}/look`, {})).status).toBe(200);
  expect((await (await post("sam", `/api/repos/ryan/lab/agents/${id}/hold`, {})).json() as any).pending.until).toBeNull();
  expect((await post("sam", `/api/repos/ryan/lab/agents/${id}/accept`, {})).status).toBe(403);
  expect((await post("sam", `/api/repos/ryan/lab/agents/${id}/reject`, {})).status).toBe(403);
  expect((await (await call("sam", "/api/repos/ryan/lab/agents/waiting?path=a.js")).json() as W).waiting[0]!.pending.until).toBeNull();

  // A private repo's batch is the crew's alone.
  await call("ryan", "/api/repos/ryan/lab", { method: "PUT", body: JSON.stringify({ visibility: "private" }) });
  expect((await call("eve", "/api/repos/ryan/lab/agents/waiting?path=a.js")).status).toBe(404);
  expect((await call("sam", "/api/repos/ryan/lab/agents/waiting?path=a.js")).status).toBe(200);
});

test("what a landing kept is the crew's to see, not every reader's", async () => {
  const { call, post } = await app();
  await post("sam", "/api/login", { name: "sam" });
  await post("ryan", "/api/repos/ryan/lab/collaborators", { name: "sam" });
  const { id } = await waiting(call, post);
  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.js")).json() as { lines: { id: string; rev: number }[] };
  await post("ryan", "/api/repos/ryan/lab/do/ops?path=a.js", { ops: [{ kind: "set", line: doc.lines[1]!.id, base: doc.lines[1]!.rev, text: "const b = 2" }] });
  await post("ryan", `/api/repos/ryan/lab/agents/${id}/accept`, {});
  const crew = await (await call("sam", "/api/repos/ryan/lab/agents/waiting?path=a.js")).json() as any;
  expect(crew).toMatchObject({ waiting: [], kept: [{ line: doc.lines[1]!.id, yours: "const b = 2", wanted: "LET B = 2", agent: "agent-claude" }] });
  expect((await (await call(null, "/api/repos/ryan/lab/agents/waiting?path=a.js")).json() as any).kept).toEqual([]);
});

test("a rejected batch never lands, and its branch goes", async () => {
  const { call, post } = await app();
  const { id } = await waiting(call, post);
  expect((await (await post("ryan", `/api/repos/ryan/lab/agents/${id}/reject`, {})).json() as any).rejected).toMatchObject({ by: "ryan" });
  expect(await mainText(call)).toEqual(["let a = 1", "let b = 2"]);
  expect(await (await call("ryan", "/api/repos/ryan/lab/branches")).json()).toEqual([]);
  expect((await post("ryan", `/api/repos/ryan/lab/agents/${id}/accept`, {})).status).toBe(409);
});

test("with AGENT_REVIEW_MS=0 the agent writes main as it goes, with no branch", async () => {
  const { call, post } = await app();
  call.env.AGENT_REVIEW_MS = "0";
  await post("ryan", "/api/repos/ryan/lab/agents", { path: "a.js", harness: "pi", task: "shout" });
  await until(async () => (await runsOf(call))[0].status !== "running");
  expect((await runsOf(call))[0].pending).toBeUndefined();
  expect(await mainText(call)).toEqual(["LET A = 1", "LET B = 2"]);
  expect(await (await call("ryan", "/api/repos/ryan/lab/branches")).json()).toEqual([]);
});
