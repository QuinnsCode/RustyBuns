import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { pollGithub, startChecks, watchGithub } from "../src/checks.ts";

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
    hooks.push({ event: new Headers(init.headers).get("x-codesplitters-event")!, body: JSON.parse(String(init.body)) });
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
  expect(await (await call("ryan", "/api/repos/ryan/lab/checks/settings")).json()).toEqual({ where: null, required: [], post_statuses: false, github: null });
  await send("ana", "/api/login", { name: "ana" });
  expect((await send("ana", "/api/repos/ryan/lab/checks/settings", { where: "here" }, "PUT")).status).toBe(403);
  expect((await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "everywhere" }, "PUT")).status).toBe(400);
  expect((await send("ryan", "/api/repos/ryan/lab/checks/settings", { required: ["a,b"] }, "PUT")).status).toBe(400);
  // Nothing runs here until the owner says so.
  expect((await send("ryan", "/api/repos/ryan/lab/checks/run", { ref: "main" })).status).toBe(409);
  const s = await (await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "both", required: ["test"] }, "PUT")).json();
  expect(s).toMatchObject({ where: "both", required: ["test"], post_statuses: false });
  // Leaving a field out keeps it.
  expect(await (await send("ryan", "/api/repos/ryan/lab/checks/settings", { post_statuses: true }, "PUT")).json()).toMatchObject({ where: "both", required: ["test"], post_statuses: true });
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
  expect((await checks("tidy")).gate).toEqual({ required: ["test", "lint"], ok: true, passed: ["test", "lint"], waiting: [], failed: [] });
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
  expect(github.posted).toEqual([{ path: `/repos/QuinnsCode/RustyBuns/statuses/${SHA}`, body: { state: "pending", context: "codesplitters/test", description: "desktop: queued" } }]);

  github.runs = [{ id: 7, name: "typecheck", status: "in_progress", conclusion: null, started_at: "2026-10-10T10:00:00Z", html_url: "https://github.com/QuinnsCode/RustyBuns/actions/runs/1/job/7" }];
  github.statuses = [
    { context: "codesplitters/test", state: "pending" },   // ours, echoed back
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
  expect(github.posted.at(-1)!.body).toMatchObject({ state: "success", context: "codesplitters/test" });
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
