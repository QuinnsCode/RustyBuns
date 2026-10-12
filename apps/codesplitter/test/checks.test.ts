import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { expireQueued, pathMatches, planFrom, pollGithub, requeueStale, STALE, startChecks, UNCLAIMED, watchGithub } from "../src/checks.ts";
import worker from "../src/worker.ts";

// End to end, with real git: a full run on a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const SHA = "a".repeat(40);

/** The app with an outbox for webhooks and a fake GitHub API, which answers from `github`. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const hooks: { event: string; body: any }[] = [];
  call.env.HOOK_FETCH = async (_url: string, init: RequestInit) => {
    hooks.push({ event: new Headers(init.headers).get("x-codesplitter-event")!, body: JSON.parse(String(init.body)) });
    return new Response("ok");
  };
  const github = { runs: [] as any[], statuses: [] as any[], posted: [] as { path: string; body: any }[] };
  call.env.GITHUB_FETCH = async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === "POST") { github.posted.push({ path, body: JSON.parse(String(init.body)) }); return Response.json({}, { status: 201 }); }
    if (path.endsWith("/check-runs")) return Response.json({ total_count: github.runs.length, check_runs: github.runs });
    if (path.endsWith("/status")) return Response.json({ state: "pending", statuses: github.statuses });
    return Response.json({ message: "Not Found" }, { status: 404 });
  };
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
  await send("ryan", "/api/repos/ryan/lab/hooks", { url: "https://ci.example/hook", events: ["check_run"] });
  const checks = async (ref = "main") => (await call("ryan", `/api/repos/ryan/lab/checks?ref=${ref}`)).json() as Promise<any>;
  return { call, send, hooks, github, checks };
}

const arrived = async <T>(got: T[], n: number) => {
  for (const end = performance.now() + 15_000; performance.now() < end && got.length < n;) await Bun.sleep(10);
  return got;
};

test("settings: none by default, the owner's to change", async () => {
  const { call, send } = await app();
  expect(await (await call("ryan", "/api/repos/ryan/lab/checks/settings")).json()).toEqual({ where: null, required: [], post_statuses: false, github: null, offline: false, down_since: null, here: false });
  await send("ana", "/api/login", { name: "ana" });
  expect((await send("ana", "/api/repos/ryan/lab/checks/settings", { where: "here" }, "PUT")).status).toBe(403);
  expect((await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "everywhere" }, "PUT")).status).toBe(400);
  expect((await send("ryan", "/api/repos/ryan/lab/checks/settings", { required: ["a,b"] }, "PUT")).status).toBe(400);
  // Running here is on offer whatever the setting; main just needs a commit to run on.
  expect((await send("ryan", "/api/repos/ryan/lab/checks/run", { ref: "main" })).status).toBe(409);
  expect((await send("ryan", "/api/repos/ryan/lab/checks/run", { ref: "nope" })).status).toBe(404);
  const s = await (await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "both", required: ["test"] }, "PUT")).json();
  expect(s).toMatchObject({ where: "both", required: [{ name: "test" }], post_statuses: false });
  // Leaving a field out keeps it.
  expect(await (await send("ryan", "/api/repos/ryan/lab/checks/settings", { post_statuses: true }, "PUT")).json()).toMatchObject({ where: "both", required: [{ name: "test" }], post_statuses: true });
});

test("a commit to main queues our check; a runner reports on it, and each step is a check_run webhook", async () => {
  const { call, send, hooks, checks } = await app();
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=a.ts", { message: "first" });
  expect((await checks()).runs).toEqual([]);   // checks don't run anywhere yet

  await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "here" }, "PUT");
  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.ts")).json();
  await send("ryan", "/api/repos/ryan/lab/do/ops?path=a.ts", { ops: [{ kind: "set", line: doc.lines[0].id, text: "ONE", base: doc.lines[0].rev }] });
  const c = await (await send("ryan", "/api/repos/ryan/lab/do/commit?path=a.ts", { message: "second" })).json();
  const k = await checks();
  expect(k.sha).toBe(c.git.commit);
  expect(k.runs).toMatchObject([{ name: "test", runner: "desktop", status: "queued", ref: "main", sha: c.git.commit }]);
  const id = k.runs[0].id;

  await arrived(hooks, 1);
  expect(hooks[0]).toMatchObject({ event: "check_run", body: { action: "created", check_run: { id, name: "test", head_sha: c.git.commit, status: "queued", conclusion: null } } });

  await send("ryan", `/api/repos/ryan/lab/checks/${id}`, { status: "running", append: "bun test\n" }, "PUT");
  const done = await (await send("ryan", `/api/repos/ryan/lab/checks/${id}`, { status: "passed", append: "3 pass\n" }, "PUT")).json();
  expect(done).toMatchObject({ status: "passed", log: "bun test\n3 pass\n" });
  expect(done.finished_at).toBeGreaterThanOrEqual(done.started_at);
  // A finished run stays finished.
  expect((await send("ryan", `/api/repos/ryan/lab/checks/${id}`, { status: "failed" }, "PUT")).status).toBe(409);
  expect((await send("ryan", `/api/repos/ryan/lab/checks/${id}/cancel`, {})).status).toBe(409);
  await arrived(hooks, 2);
  expect(hooks[1]).toMatchObject({ body: { action: "completed", check_run: { status: "completed", conclusion: "success" } } });
  expect((await call("ryan", `/api/repos/ryan/lab/checks/${id}`)).status).toBe(200);
  expect((await call("ryan", "/api/repos/ryan/lab/checks/999")).status).toBe(404);

  // Pressing Run again on the same commit queues a new one; one already queued isn't doubled.
  await send("ryan", "/api/repos/ryan/lab/checks/run", { ref: "main" });
  await send("ryan", "/api/repos/ryan/lab/checks/run", { ref: "main" });
  const again = (await call("ryan", `/api/repos/ryan/lab/checks/${id + 1}`)).status;
  expect(again).toBe(200);
  expect((await call("ryan", `/api/repos/ryan/lab/checks/${id + 2}`)).status).toBe(404);
  const cancelled = await (await send("ryan", `/api/repos/ryan/lab/checks/${id + 1}/cancel`, {})).json();
  expect(cancelled.status).toBe("cancelled");
});

test("a required check gates the merge: missing waits, failed blocks, passed lets it through", async () => {
  const { call, send, checks } = await app();
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=a.ts", { message: "first" });
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "tidy" });
  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.ts&branch=tidy")).json();
  await send("ryan", "/api/repos/ryan/lab/do/ops?path=a.ts&branch=tidy", { ops: [{ kind: "set", line: doc.lines[0].id, text: "ONE", base: doc.lines[0].rev }] });
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { required: ["test", "lint"] }, "PUT");

  let m = await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {});
  expect(m.status).toBe(409);
  expect(await m.json()).toMatchObject({ checks: { ok: false, waiting: ["test", "lint"], failed: [] } });

  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "tidy", sha: SHA, name: "test", status: "failed" });
  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "tidy", sha: SHA, name: "lint", status: "running" });
  m = await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {});
  expect(m.status).toBe(409);
  const why = await m.json();
  expect(why.checks).toMatchObject({ failed: ["test"], waiting: ["lint"] });
  expect(why.error).toContain("test failed");

  // The review carries the checks, for the branch page and the phone.
  const review = await (await call("ryan", "/api/repos/ryan/lab/branches/tidy")).json();
  expect(review.checks).toMatchObject({ ref: "tidy", sha: SHA, gate: { ok: false } });
  expect(review.checks.runs.map((r: any) => `${r.name}:${r.status}`)).toEqual(["test:failed", "lint:running"]);

  // A rerun that passes is the newest of its name, and settles it.
  const lint = (review.checks.runs as any[]).find((r) => r.name === "lint");
  await send("ryan", `/api/repos/ryan/lab/checks/${lint.id}`, { status: "passed" }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "tidy", sha: SHA, name: "test", status: "passed" });
  expect((await checks("tidy")).gate).toEqual({ required: ["test", "lint"], ok: true, passed: ["test", "lint"], waiting: [], failed: [], deferred: [], skipped: [] });
  expect((await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {})).status).toBe(200);
});

test("* requires every check that ran; none at all holds it", async () => {
  const { send, checks } = await app();
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { required: ["*"] }, "PUT");
  expect((await checks("x")).gate).toMatchObject({ ok: false, waiting: ["*"] });
  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "x", sha: SHA, name: "build", status: "passed" });
  expect((await checks("x")).gate.ok).toBe(true);
  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "x", sha: SHA, name: "e2e", status: "cancelled" });
  expect((await checks("x")).gate).toMatchObject({ ok: false, failed: ["e2e"] });
});

test("GitHub's results for a sha sent up come back in beside ours, and ours go out as statuses", async () => {
  const { call, send, github, checks } = await app();
  // A mirror of a GitHub repo (set by hand: a real mirror would fetch from github.com).
  await call.env.DB.prepare("UPDATE repos SET mirror_url = 'https://github.com/QuinnsCode/RustyBuns.git' WHERE owner = 'ryan' AND name = 'lab'").run();
  expect(await (await call("ryan", "/api/repos/ryan/lab/checks/settings")).json()).toMatchObject({ where: "github", github: "QuinnsCode/RustyBuns" });
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "both", post_statuses: true, required: ["test", "typecheck"] }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "tidy" });

  // The branch went up as SHA: our check is queued, and GitHub's is watched.
  await startChecks(call.env, "ryan", "lab", "tidy", SHA, "ryan");
  expect(github.posted).toEqual([
    { path: `/repos/QuinnsCode/RustyBuns/statuses/${SHA}`, body: { state: "pending", context: "codesplitter/test", description: "desktop: queued" } }]);

  github.runs = [{ id: 7, name: "typecheck", status: "in_progress", conclusion: null, started_at: "2026-10-10T10:00:00Z", html_url: "https://github.com/QuinnsCode/RustyBuns/actions/runs/1/job/7" }];
  github.statuses = [
    { context: "codesplitter/test", state: "pending" },    // ours, echoed back
    { context: "ci/other", state: "success", target_url: "https://ci.example/1", created_at: "2026-10-10T10:00:00Z", updated_at: "2026-10-10T10:01:00Z" },
  ];
  const polled = await (await send("ryan", "/api/repos/ryan/lab/checks/github", { ref: "tidy" })).json();
  expect(polled.polled).toEqual([{ sha: SHA, imported: 2, done: false }]);
  let k = await checks("tidy");
  expect(k.runs.map((r: any) => `${r.runner}:${r.name}:${r.status}`)).toEqual(["desktop:test:queued", "github:typecheck:running", "github:ci/other:passed"]);
  expect(k.runs[1].url).toBe("https://github.com/QuinnsCode/RustyBuns/actions/runs/1/job/7");
  expect(k.gate).toMatchObject({ ok: false, waiting: ["test", "typecheck"] });
  // GitHub's are cancelled and reported on on GitHub.
  expect((await send("ryan", `/api/repos/ryan/lab/checks/${k.runs[1].id}/cancel`, {})).status).toBe(409);
  expect((await send("ryan", `/api/repos/ryan/lab/checks/${k.runs[1].id}`, { status: "passed" }, "PUT")).status).toBe(409);

  // The job fails on GitHub: the next poll updates it rather than adding another, and the merge is blocked.
  github.runs = [{ ...github.runs[0], status: "completed", conclusion: "failure", completed_at: "2026-10-10T10:05:00Z" }];
  await pollGithub(call.env);
  await send("ryan", `/api/repos/ryan/lab/checks/${k.runs[0].id}`, { status: "passed" }, "PUT");
  k = await checks("tidy");
  expect(k.runs.map((r: any) => `${r.runner}:${r.name}:${r.status}`)).toEqual(["desktop:test:passed", "github:typecheck:failed", "github:ci/other:passed"]);
  expect(k.gate).toMatchObject({ ok: false, failed: ["typecheck"], passed: ["test"] });
  expect(github.posted.at(-1)!.body).toMatchObject({ state: "success", context: "codesplitter/test" });
  const m = await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {});
  expect(m.status).toBe(409);
  expect((await m.json()).error).toContain("typecheck failed");

  // Everything finished: the watch is dropped, so the cron stops asking.
  expect(await call.env.DB.prepare("SELECT COUNT(*) AS n FROM check_watches").first()).toEqual({ n: 0 });
});

test("a watch whose time is up stops; a repo that doesn't mirror GitHub has nothing to fetch", async () => {
  const { call, send } = await app();
  await call.env.DB.prepare("UPDATE repos SET mirror_url = 'https://github.com/o/r.git' WHERE owner = 'ryan' AND name = 'lab'").run();
  await watchGithub(call.env, "ryan", "lab", "main", SHA);
  await pollGithub(call.env);   // GitHub has nothing for it yet: still watched
  expect(await call.env.DB.prepare("SELECT COUNT(*) AS n FROM check_watches").first()).toEqual({ n: 1 });
  await pollGithub(call.env, Date.now() + 3 * 3600_000);
  expect(await call.env.DB.prepare("SELECT COUNT(*) AS n FROM check_watches").first()).toEqual({ n: 0 });

  await call.env.DB.prepare("UPDATE repos SET mirror_url = NULL WHERE owner = 'ryan' AND name = 'lab'").run();
  await watchGithub(call.env, "ryan", "lab", "main", SHA);
  expect(await (await send("ryan", "/api/repos/ryan/lab/checks/github", {})).json()).toEqual({ polled: [{ error: "this repo doesn't mirror a GitHub repo" }] });
});

test("GitHub down: checks run here instead, and a merge goes on ours with GitHub's deferred", async () => {
  const { call, send, checks } = await app();
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "tidy" });
  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.ts&branch=tidy")).json();
  await send("ryan", "/api/repos/ryan/lab/do/ops?path=a.ts&branch=tidy", { ops: [{ kind: "set", line: doc.lines[0].id, text: "ONE", base: doc.lines[0].rev }] });
  const down = Date.now() - 60_000;
  await call.env.DB.prepare("UPDATE repos SET mirror_url = 'https://github.com/o/r.git', mirror_state = 'down', mirror_down_since = ? WHERE owner = 'ryan' AND name = 'lab'").bind(down).run();
  // GitHub first (the default for a mirror), and GitHub required.
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { required: ["typecheck"] }, "PUT");
  expect(await (await call("ryan", "/api/repos/ryan/lab/checks/settings")).json()).toMatchObject({ where: "github", offline: true, down_since: down, here: true });

  // The branch is checked here in GitHub's place.
  await startChecks(call.env, "ryan", "lab", "tidy", SHA, "ryan");
  let k = await checks("tidy");
  expect(k.runs).toMatchObject([{ name: "test", runner: "desktop", status: "queued" }]);
  expect((await (await call("ryan", `/api/repos/ryan/lab/checks/${k.runs[0].id}`)).json()).log).toContain("GitHub is down");
  expect(k.gate).toMatchObject({ ok: false, waiting: ["typecheck"], deferred: [] });
  const m = await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {});
  expect(m.status).toBe(409);
  expect((await m.json()).error).toContain("GitHub is down: run checks here");

  // Ours pass: GitHub's required check is put off, and the merge goes.
  await send("ryan", `/api/repos/ryan/lab/checks/${k.runs[0].id}`, { status: "passed" }, "PUT");
  k = await checks("tidy");
  expect(k.gate).toMatchObject({ ok: true, waiting: [], deferred: ["typecheck"] });
  expect((await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {})).status).toBe(200);

  // GitHub's back: it's GitHub's turn again, and nothing more queues here.
  await call.env.DB.prepare("UPDATE repos SET mirror_state = 'ok', mirror_down_since = NULL WHERE owner = 'ryan' AND name = 'lab'").run();
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "next" });
  await startChecks(call.env, "ryan", "lab", "next", "b".repeat(40), "ryan");
  expect((await checks("next")).runs).toEqual([]);
  expect(await call.env.DB.prepare("SELECT ref FROM check_watches WHERE sha = ?").bind("b".repeat(40)).first()).toEqual({ ref: "next" });
});

test("a failing check of ours isn't deferred, GitHub down or not", async () => {
  const { call, send, checks } = await app();
  await call.env.DB.prepare("UPDATE repos SET mirror_url = 'https://github.com/o/r.git', mirror_state = 'down' WHERE owner = 'ryan' AND name = 'lab'").run();
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { required: ["typecheck", "test"] }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "x", sha: SHA, name: "test", status: "failed" });
  expect((await checks("x")).gate).toMatchObject({ ok: false, failed: ["test"], waiting: ["typecheck"], deferred: [] });
});

test("two runners race for one queued run: only one gets it, and names pick which", async () => {
  const { send, checks } = await app();
  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "main", sha: SHA, name: "lint" });
  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "main", sha: SHA, name: "test" });
  expect((await send("ryan", "/api/repos/ryan/lab/checks/claim", {})).status).toBe(400);
  // Only test, please: lint is older but isn't this runner's.
  const [a, b] = await Promise.all(["box-a", "box-b"].map((runner_label) => send("ryan", "/api/repos/ryan/lab/checks/claim", { runner_label, names: ["test"] })));
  expect([a.status, b.status].sort()).toEqual([200, 204]);
  const won = await (a.status === 200 ? a : b).json();
  expect(won).toMatchObject({ ref: "main", sha: SHA, name: "test", stale_after_s: STALE / 1000 });
  expect((await checks()).runs.map((r: any) => `${r.name}:${r.status}:${r.runner_label}`)).toEqual(["lint:queued:by hand: @ryan", `test:running:${a.status === 200 ? "box-a" : "box-b"}`]);
  // With no names it's the oldest left; then there's nothing.
  expect(await (await send("ryan", "/api/repos/ryan/lab/checks/claim", { runner_label: "box-b" })).json()).toMatchObject({ name: "lint" });
  expect((await send("ryan", "/api/repos/ryan/lab/checks/claim", { runner_label: "box-b" })).status).toBe(204);
  // Outside the crew, no claiming.
  await send("ana", "/api/login", { name: "ana" });
  expect((await send("ana", "/api/repos/ryan/lab/checks/claim", { runner_label: "x" })).status).toBe(403);
});

test("a claimed run that goes quiet goes back in the queue, and its old runner can't report on it", async () => {
  const { call, send } = await app();
  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "main", sha: SHA, name: "test" });
  const { id } = await (await send("ryan", "/api/repos/ryan/lab/checks/claim", { runner_label: "laptop" })).json();
  // Heard from: still its.
  await send("ryan", `/api/repos/ryan/lab/checks/${id}`, { runner_label: "laptop", append: "running\n" }, "PUT");
  expect(await requeueStale(call.env, Date.now() + STALE / 2)).toBe(0);

  expect(await requeueStale(call.env, Date.now() + STALE + 1000)).toBe(1);
  const run = await (await call("ryan", `/api/repos/ryan/lab/checks/${id}`)).json();
  expect(run).toMatchObject({ status: "queued", runner_label: null, started_at: null });
  expect(run.log).toContain("no word from laptop in 10 minutes: back in the queue");
  expect((await send("ryan", `/api/repos/ryan/lab/checks/${id}`, { runner_label: "laptop", status: "passed" }, "PUT")).status).toBe(409);

  // Someone else takes it, and the laptop waking up still can't.
  expect(await (await send("ryan", "/api/repos/ryan/lab/checks/claim", { runner_label: "build-box" })).json()).toMatchObject({ id });
  const late = await send("ryan", `/api/repos/ryan/lab/checks/${id}`, { runner_label: "laptop", status: "failed" }, "PUT");
  expect(late.status).toBe(409);
  expect((await late.json()).error).toBe("build-box has it now");
  expect((await send("ryan", `/api/repos/ryan/lab/checks/${id}`, { runner_label: "build-box", status: "passed" }, "PUT")).status).toBe(200);
});

test("paths: a pattern is a directory, a file or a glob", () => {
  expect(pathMatches("apps/a", "apps/a/src/x.ts")).toBe(true);
  expect(pathMatches("apps/a/", "apps/a/x.ts")).toBe(true);
  expect(pathMatches("apps/a", "apps/ab/x.ts")).toBe(false);
  expect(pathMatches("package.json", "package.json")).toBe(true);
  expect(pathMatches("apps/*/package.json", "apps/b/package.json")).toBe(true);
  expect(pathMatches("apps/*/package.json", "apps/b/c/package.json")).toBe(false);
  expect(pathMatches("**/*.ts", "a.ts")).toBe(true);
  expect(pathMatches("apps/b/**", "apps/b/deep/x.ts")).toBe(true);
});

test("a required check scoped to paths: a change in apps/a doesn't wait on b-tests, and only a-tests queues", async () => {
  const { call, send, checks } = await app();
  await send("ryan", "/api/repos/ryan/lab/files", { path: "apps/a/x.ts", content: "a" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "apps/b/y.ts", content: "b" });
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=apps/a/x.ts", { message: "a" });
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=apps/b/y.ts", { message: "b" });
  expect((await send("ryan", "/api/repos/ryan/lab/checks/settings", { required: [{ name: "b", paths: "apps/b" }] }, "PUT")).status).toBe(400);
  const s = await (await send("ryan", "/api/repos/ryan/lab/checks/settings", {
    where: "here", required: ["lint", { name: "a-tests", paths: ["apps/a"], command: "bun test apps/a" }, { name: "b-tests", paths: ["apps/b/**"], command: "bun test apps/b" }],
  }, "PUT")).json();
  expect(s.required).toEqual([{ name: "lint" }, { name: "a-tests", paths: ["apps/a"], command: "bun test apps/a" }, { name: "b-tests", paths: ["apps/b/**"], command: "bun test apps/b" }]);

  await send("ryan", "/api/repos/ryan/lab/branches", { name: "tidy" });
  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=apps/a/x.ts&branch=tidy")).json();
  await send("ryan", "/api/repos/ryan/lab/do/ops?path=apps/a/x.ts&branch=tidy", { ops: [{ kind: "set", line: doc.lines[0].id, text: "A", base: doc.lines[0].rev }] });

  // Queueing: the scoped check with a command that the branch calls for, not b-tests (lint has no command: someone else runs it).
  await startChecks(call.env, "ryan", "lab", "tidy", SHA, "ryan");
  let k = await checks("tidy");
  expect(k.runs.map((r: any) => r.name)).toEqual(["a-tests"]);
  expect(k.gate).toMatchObject({ required: ["lint", "a-tests"], skipped: ["b-tests"], waiting: ["lint", "a-tests"] });
  // Its command comes with the claim.
  expect(await (await send("ryan", "/api/repos/ryan/lab/checks/claim", { runner_label: "box" })).json()).toMatchObject({ name: "a-tests", command: "bun test apps/a" });

  await send("ryan", `/api/repos/ryan/lab/checks/${k.runs[0].id}`, { status: "passed" }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "tidy", sha: SHA, name: "lint", status: "passed" });
  k = await checks("tidy");
  expect(k.gate).toMatchObject({ ok: true, passed: ["lint", "a-tests"], skipped: ["b-tests"] });
  expect((await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {})).status).toBe(200);

  // Main isn't a branch: nothing says what changed, so every required check applies.
  expect((await checks("main")).gate).toMatchObject({ required: ["lint", "a-tests", "b-tests"], skipped: [] });
});

test("the reference runner claims a run, clones, runs a real bun test and reports it passed, without handing the command its token (#618)", async () => {
  const { call, send } = await app();
  const server = Bun.serve({ port: 0, fetch: (req) => worker.fetch(req, call.env) });
  opened.push({ close: () => server.stop(true) });
  const { token: secret } = await (await send("ryan", "/api/tokens", { label: "runner", scope: "write" })).json();
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "here", required: [{ name: "test", command: 'bun test ./math.test.ts && echo "seen: token=${CODESPLITTERS_TOKEN-unset} url=${CODESPLITTERS_URL-unset} ci=$CI"' }] }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/files", { path: "math.test.ts", content: 'import { expect, test } from "bun:test";\ntest("adds", () => expect(1 + 1).toBe(2));' });
  const c = await (await send("ryan", "/api/repos/ryan/lab/do/commit?path=math.test.ts", { message: "a test" })).json();

  const p = Bun.spawn(["bun", "scripts/runner.ts", "ryan/lab", "--once", "--label", "ci-box"], {
    cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, CODESPLITTERS_URL: `http://127.0.0.1:${server.port}`, CODESPLITTERS_TOKEN: secret },
  });
  const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect({ code, err }).toEqual({ code: 0, err: "" });
  expect(out).toContain(`ci-box: test on main at ${c.git.commit.slice(0, 7)}`);
  const { runs } = await (await call("ryan", "/api/repos/ryan/lab/checks")).json();
  expect(runs).toMatchObject([{ name: "test", sha: c.git.commit, status: "passed", runner_label: "ci-box" }]);
  const log = (await (await call("ryan", `/api/repos/ryan/lab/checks/${runs[0].id}`)).json()).log;
  expect(log).toContain("$ bun test ./math.test.ts");
  expect(log).toContain("1 pass");
  expect(log).toContain("exit 0");
  expect(log).toContain("seen: token=unset url=unset ci=1");
  expect(log).not.toContain(secret);
});

test("a collaborator can't pass a check it didn't run: only the claimer or the owner says how it went (#645)", async () => {
  const { call, send, checks } = await app();
  await send("ryan", "/api/repos/ryan/lab/collaborators", { name: "agent-x" });
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { required: ["test"] }, "PUT");
  // By hand, a collaborator only queues one, and it says who.
  expect((await send("agent-x", "/api/repos/ryan/lab/checks", { ref: "main", sha: SHA, name: "test", status: "passed" })).status).toBe(403);
  const queued = await (await send("agent-x", "/api/repos/ryan/lab/checks", { ref: "main", sha: SHA, name: "test" })).json();
  expect(queued).toMatchObject({ status: "queued", runner_label: "by hand: @agent-x" });
  expect(queued.log).toContain("recorded by hand by @agent-x");
  // Nor can it finish one nobody claimed.
  expect((await send("agent-x", `/api/repos/ryan/lab/checks/${queued.id}`, { status: "passed" }, "PUT")).status).toBe(403);
  expect((await checks()).gate.ok).toBe(false);
  // The owner's runner claims it; only it (or the owner) reports.
  const { id } = await (await send("ryan", "/api/repos/ryan/lab/checks/claim", { runner_label: "box" })).json();
  expect((await send("agent-x", `/api/repos/ryan/lab/checks/${id}`, { runner_label: "box", status: "passed" }, "PUT")).status).toBe(403);
  expect((await send("ryan", `/api/repos/ryan/lab/checks/${id}`, { runner_label: "box", status: "passed" }, "PUT")).status).toBe(200);
  expect((await checks()).gate.ok).toBe(true);
  // A runner the collaborator claimed is its own to report on.
  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "main", sha: SHA, name: "lint" });
  const mine = await (await send("agent-x", "/api/repos/ryan/lab/checks/claim", { runner_label: "agent-box" })).json();
  expect((await send("agent-x", `/api/repos/ryan/lab/checks/${mine.id}`, { runner_label: "agent-box", status: "failed" }, "PUT")).status).toBe(200);
  expect(await (await call("ryan", `/api/repos/ryan/lab/checks/${mine.id}`)).json()).toMatchObject({ status: "failed", claimed_by: "agent-x" });
});

test("what runs here: codesplitter.ci says, else package.json's scripts, else one test run (#463)", () => {
  expect(planFrom(null, null)).toEqual([]);
  expect(planFrom(null, JSON.stringify({ scripts: { test: "bun test", typecheck: "tsc", dev: "vite" } }))).toEqual([
    { name: "test", command: "bun run test" }, { name: "typecheck", command: "bun run typecheck" },
  ]);
  // Any command, a path scope, and a broken entry left out; codesplitter.ci wins over package.json.
  expect(planFrom(JSON.stringify({ image: { run: "docker build .", paths: ["Dockerfile", "src/**"] }, lint: "biome check", "a,b": "x", empty: { run: "" } }), JSON.stringify({ scripts: { test: "bun test" } }))).toEqual([
    { name: "image", command: "docker build .", paths: ["Dockerfile", "src/**"] }, { name: "lint", command: "biome check" },
  ]);
  expect(planFrom("not json", JSON.stringify({ scripts: { test: "x" } }))).toEqual([{ name: "test", command: "bun run test" }]);
});

test("a commit queues the repo's own checks, scoped by paths, each with its command for the runner (#463, #490)", async () => {
  const { call, send, checks } = await app();
  await send("ryan", "/api/repos/ryan/lab/files", { path: "codesplitter.ci", content: JSON.stringify({ test: "ignored: the required one wins", lint: "biome check", image: { run: "docker build .", paths: ["Dockerfile"] } }) });
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "github", required: [{ name: "test", command: "bun test ./a" }] }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "tidy" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "x.ts", content: "x", branch: "tidy" });
  await send("ryan", "/api/repos/ryan/lab/checks/run", { ref: "tidy" });
  // The branch doesn't touch the Dockerfile, so image isn't queued; main would run all three.
  const runs = (await checks("tidy")).runs;
  expect(runs.map((r: any) => r.name)).toEqual(["test", "lint"]);
  expect(await (await send("ryan", "/api/repos/ryan/lab/checks/claim", { runner_label: "box" })).json()).toMatchObject({ name: "test", command: "bun test ./a" });
  expect(await (await send("ryan", "/api/repos/ryan/lab/checks/claim", { runner_label: "box" })).json()).toMatchObject({ name: "lint", command: "biome check" });
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=codesplitter.ci", { message: "ci" });
  await send("ryan", "/api/repos/ryan/lab/checks/run", { ref: "main" });
  expect((await checks()).runs.map((r: any) => r.name)).toEqual(["test", "lint", "image"]);
  expect(await (await call("ryan", `/api/repos/ryan/lab/checks/${(await checks()).runs[2].id}`)).json()).toMatchObject({ command: "docker build ." });
});

test("queued runs nobody picks up are cancelled by the cron, saying so, and the gate stops waiting on them (#490)", async () => {
  const { call, send, hooks, checks } = await app();
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "here", required: ["test"] }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "main", sha: SHA, name: "test" });
  expect(await expireQueued(call.env)).toBe(0);   // not old yet
  expect((await checks()).gate).toMatchObject({ ok: false, waiting: ["test"] });
  expect(await expireQueued(call.env, Date.now() + UNCLAIMED + 1)).toBe(1);
  const [run] = (await checks()).runs;
  expect(run.status).toBe("cancelled");
  expect((await (await call("ryan", `/api/repos/ryan/lab/checks/${run.id}`)).json()).log).toContain("no runner picked it up in 6 hours");
  expect((await checks()).gate).toMatchObject({ ok: false, waiting: [], failed: ["test"] });
  await arrived(hooks, 2);
  expect(hooks.at(-1)).toMatchObject({ body: { action: "completed", check_run: { conclusion: "cancelled" } } });
  // A finished run is never expired again.
  expect(await expireQueued(call.env, Date.now() + UNCLAIMED + 1)).toBe(0);
});

/** Wait for a branch edit's stamp: the file's copy writes it after the edit's answered. */
const stamped = async (checks: (ref?: string) => Promise<any>, ref: string, after = 0) => {
  for (const end = performance.now() + 15_000; performance.now() < end; await Bun.sleep(10)) {
    const k = await checks(ref);
    if (k.changed_at && k.changed_at > after) return k;
  }
  throw new Error("the branch was never stamped");
};

test("an edit to a branch after its checks passed makes them stale: the merge waits again (#489)", async () => {
  const { call, send, checks } = await app();
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { required: ["test"] }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "tidy" });
  const edit = async (text: string) => {
    const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.ts&branch=tidy")).json();
    await send("ryan", "/api/repos/ryan/lab/do/ops?path=a.ts&branch=tidy", { ops: [{ kind: "set", line: doc.lines[0].id, text, base: doc.lines[0].rev }] });
  };
  await edit("ONE");
  const first = (await stamped(checks, "tidy")).changed_at;
  await Bun.sleep(5);
  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "tidy", sha: SHA, name: "test", status: "passed" });
  expect((await checks("tidy")).gate).toMatchObject({ ok: true, passed: ["test"] });
  expect((await checks("tidy")).stale).toBe(false);

  await Bun.sleep(5);
  await edit("One");
  const k = await stamped(checks, "tidy", first);
  expect(k).toMatchObject({ stale: true, gate: { ok: false, passed: [], waiting: ["test"] } });
  // Checks don't run here, so nothing was queued: the last run still shows, but doesn't count.
  expect(k.runs).toMatchObject([{ name: "test", status: "passed" }]);
  const merge = await (await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {})).json();
  expect(merge.error).toContain("the branch changed since its checks ran");

  // A fresh run lets it through.
  await Bun.sleep(5);
  await send("ryan", "/api/repos/ryan/lab/checks", { ref: "tidy", sha: "b".repeat(40), name: "test", status: "passed" });
  expect((await checks("tidy")).gate).toMatchObject({ ok: true, passed: ["test"] });
  expect((await checks("tidy")).stale).toBe(false);
});

test("with checks running here, edits to a branch queue one run, read when a runner claims it (#489)", async () => {
  const { call, send, checks } = await app();
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "here", required: ["test"] }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "tidy" });
  const edit = async (text: string) => {
    const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.ts&branch=tidy")).json();
    await send("ryan", "/api/repos/ryan/lab/do/ops?path=a.ts&branch=tidy", { ops: [{ kind: "set", line: doc.lines[0].id, text, base: doc.lines[0].rev }] });
  };
  await edit("ONE");
  let k = await stamped(checks, "tidy");
  await edit("One");
  k = await stamped(checks, "tidy", k.changed_at);
  // A burst of edits is one queued run, at the branch as it is here; queued, it isn't stale.
  expect(k.runs).toMatchObject([{ name: "test", status: "queued", runner: "desktop" }]);
  expect(k.sha).toMatch(/^tidy@\d+$/);
  expect(k).toMatchObject({ stale: false, gate: { waiting: ["test"] } });

  const claimed = await (await send("ryan", "/api/repos/ryan/lab/checks/claim", { runner_label: "box" })).json();
  expect(claimed).toMatchObject({ ref: "tidy", sha: k.sha });
  await send("ryan", `/api/repos/ryan/lab/checks/${claimed.id}`, { runner_label: "box", status: "passed" }, "PUT");
  expect((await checks("tidy")).gate.ok).toBe(true);

  // An edit after it was claimed: stale, and a new run's queued.
  await Bun.sleep(5);
  await edit("uno");
  k = await stamped(checks, "tidy", k.changed_at);
  for (const end = performance.now() + 15_000; performance.now() < end && k.runs[0]?.id === claimed.id; await Bun.sleep(10)) k = await checks("tidy");
  expect(k.runs).toMatchObject([{ name: "test", status: "queued" }]);
  expect(k.runs[0].id).not.toBe(claimed.id);
  expect(k.gate.ok).toBe(false);
});

test("the reference runner checks a branch edited here and not pushed: main, with the branch's files over it (#489)", async () => {
  const { call, send } = await app();
  const server = Bun.serve({ port: 0, fetch: (req) => worker.fetch(req, call.env) });
  opened.push({ close: () => server.stop(true) });
  const { token: secret } = await (await send("ryan", "/api/tokens", { label: "runner", scope: "write" })).json();
  await send("ryan", "/api/repos/ryan/lab/files", { path: "math.test.ts", content: 'import { expect, test } from "bun:test";\ntest("adds", () => expect(1 + 1).toBe(2));' });
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=math.test.ts", { message: "a test" });
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "here", required: [{ name: "test", command: "bun test ./math.test.ts" }] }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "oops" });
  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=math.test.ts&branch=oops")).json();
  await send("ryan", "/api/repos/ryan/lab/do/ops?path=math.test.ts&branch=oops", { ops: [{ kind: "set", line: doc.lines[1].id, text: 'test("adds", () => expect(1 + 1).toBe(3));', base: doc.lines[1].rev }] });
  let k: any;
  for (const end = performance.now() + 15_000; performance.now() < end && !k?.runs.length; await Bun.sleep(10)) k = await (await call("ryan", "/api/repos/ryan/lab/checks?ref=oops")).json();

  const p = Bun.spawn(["bun", "scripts/runner.ts", "ryan/lab", "--once", "--label", "ci-box"], {
    cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, CODESPLITTERS_URL: `http://127.0.0.1:${server.port}`, CODESPLITTERS_TOKEN: secret },
  });
  expect(await p.exited).toBe(0);
  const run = await (await call("ryan", `/api/repos/ryan/lab/checks/${k.runs[0].id}`)).json();
  expect(run).toMatchObject({ ref: "oops", status: "failed" });
  expect(run.log).toContain("main, with 1 file from branch oops as they are now");
  expect(run.log).toContain("1 fail");
});
