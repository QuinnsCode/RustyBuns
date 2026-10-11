import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { watchGithub } from "../src/checks.ts";

setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const SHA = "b".repeat(40);
const GH = "/api/gh/v3/repos/ryan/lab";

/** The app, a repo with a CI token, and a client that calls it the way a GitHub client would. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
  const made = await (await send("ryan", "/api/repos/ryan/lab/checks/tokens", { label: "jenkins" })).json() as { id: string; token: string };
  const github = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST", auth = `token ${made.token}`) =>
    call(null, GH + path, { method, headers: { authorization: auth, accept: "application/vnd.github+json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const checks = async (ref = "main") => (await call("ryan", `/api/repos/ryan/lab/checks?ref=${ref}`)).json() as Promise<any>;
  return { call, send, made, github, checks };
}

test("CI tokens: the owner's to make, list and revoke; the secret shows once", async () => {
  const { call, send, made, github } = await app();
  expect(made.token).toStartWith("csci_");
  await send("ana", "/api/login", { name: "ana" });
  expect((await send("ana", "/api/repos/ryan/lab/checks/tokens", { label: "x" })).status).toBe(403);
  expect((await send("ryan", "/api/repos/ryan/lab/checks/tokens", {})).status).toBe(400);
  const list = await (await call("ryan", "/api/repos/ryan/lab/checks/tokens")).json() as any[];
  expect(list).toMatchObject([{ id: made.id, label: "jenkins", last4: made.token.slice(-4), created_by: "ryan" }]);
  expect(JSON.stringify(list)).not.toContain(made.token);

  // No token, a wrong one, or one for another repo: GitHub's answers.
  expect((await github("/commits/" + SHA + "/status", undefined, "GET", "")).status).toBe(404);
  const bad = await github("/commits/" + SHA + "/status", undefined, "GET", "token nope");
  expect(bad.status).toBe(401);
  expect(await bad.json()).toMatchObject({ message: "Bad credentials" });
  await send("ryan", "/api/repos", { name: "other" });
  expect((await call(null, `/api/gh/v3/repos/ryan/other/commits/${SHA}/status`, { headers: { authorization: `token ${made.token}` } })).status).toBe(401);
  // Bearer works as well as token, and the token reaches nothing else.
  expect((await github("/commits/" + SHA + "/status", undefined, "GET", `Bearer ${made.token}`)).status).toBe(200);
  expect((await call(null, "/api/repos/ryan/lab/checks", { headers: { authorization: `Bearer ${made.token}` } })).status).toBe(401);

  expect((await send("ryan", `/api/repos/ryan/lab/checks/tokens/${made.id}`, {}, "DELETE")).status).toBe(200);
  expect((await github("/commits/" + SHA + "/status")).status).toBe(401);
});

test("POST statuses/:sha: a run per context, moved on, read back, and in GET /checks", async () => {
  const { github, checks } = await app();
  const posted = await github(`/statuses/${SHA}`, { state: "pending", context: "ci/jenkins", target_url: "https://ci.example/1", description: "building" });
  expect(posted.status).toBe(201);
  expect(await posted.json()).toMatchObject({ context: "ci/jenkins", state: "pending", target_url: "https://ci.example/1", description: "building" });
  expect((await checks()).runs).toMatchObject([{ name: "ci/jenkins", runner: "external", status: "running", sha: SHA, url: "https://ci.example/1" }]);

  await github(`/statuses/${SHA}`, { state: "success", context: "ci/jenkins", description: "all good" });
  await github(`/statuses/${SHA}`, { state: "error", context: "ci/lint" });
  const k = await checks();
  expect(k.runs).toHaveLength(2);
  expect(k.runs).toMatchObject([{ name: "ci/jenkins", status: "passed" }, { name: "ci/lint", status: "failed" }]);

  const combined = await (await github(`/commits/${SHA}/status`)).json() as any;
  expect(combined).toMatchObject({ state: "failure", sha: SHA, total_count: 2 });
  expect(combined.statuses.map((s: any) => [s.context, s.state])).toEqual([["ci/jenkins", "success"], ["ci/lint", "failure"]]);

  // A finished context posted again is a re-run: a new run, the newest one counting.
  await github(`/statuses/${SHA}`, { state: "pending", context: "ci/lint" });
  expect((await checks()).runs.find((r: any) => r.name === "ci/lint")).toMatchObject({ status: "running" });
  expect((await github(`/statuses/${SHA}`, { state: "great" })).status).toBe(422);
});

test("check-runs: POST and PATCH move a run on, GET reads them back", async () => {
  const { github, checks, call } = await app();
  const made = await github("/check-runs", { name: "build", head_sha: SHA, status: "in_progress", details_url: "https://ci.example/b" });
  expect(made.status).toBe(201);
  const run = await made.json() as any;
  expect(run).toMatchObject({ name: "build", head_sha: SHA, status: "in_progress", conclusion: null, html_url: "https://ci.example/b" });

  const done = await github(`/check-runs/${run.id}`, { status: "completed", conclusion: "failure", output: { title: "2 failed", summary: "see log" } }, "PATCH");
  expect(await done.json()).toMatchObject({ id: run.id, status: "completed", conclusion: "failure" });
  expect(await (await call("ryan", `/api/repos/ryan/lab/checks/${run.id}`)).json()).toMatchObject({ runner: "external", status: "failed", log: "2 failed\n\nsee log" });
  // A finished run stays finished.
  expect((await github(`/check-runs/${run.id}`, { conclusion: "success" }, "PATCH")).status).toBe(422);
  expect((await github("/check-runs", { name: "x", head_sha: SHA, status: "completed" })).status).toBe(422);

  // Completed at once, with a conclusion.
  await github("/check-runs", { name: "lint", head_sha: SHA, conclusion: "success" });
  const read = await (await github(`/commits/${SHA}/check-runs`)).json() as any;
  expect(read.total_count).toBe(2);
  expect(read.check_runs.map((c: any) => [c.name, c.conclusion])).toEqual([["build", "failure"], ["lint", "success"]]);
  expect((await checks()).runs.map((r: any) => [r.name, r.status])).toEqual([["build", "failed"], ["lint", "passed"]]);

  // Only external runs are its to change.
  const ours = await (await call("ryan", "/api/repos/ryan/lab/checks", { method: "POST", body: JSON.stringify({ ref: "main", sha: SHA, name: "test" }) })).json() as any;
  expect((await github(`/check-runs/${ours.id}`, { status: "in_progress" }, "PATCH")).status).toBe(404);
});

test("an external status gates a branch's merge like any required check", async () => {
  const { call, send, github, checks } = await app();
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=a.ts", { message: "first" });
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "tidy" });
  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.ts&branch=tidy")).json() as any;
  await send("ryan", "/api/repos/ryan/lab/do/ops?path=a.ts&branch=tidy", { ops: [{ kind: "set", line: doc.lines[0].id, text: "ONE", base: doc.lines[0].rev }] });
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { required: ["ci/jenkins"] }, "PUT");
  // The branch went upstream as SHA, so a status on SHA is the branch's.
  await watchGithub(call.env as any, "ryan", "lab", "tidy", SHA);

  await github(`/statuses/${SHA}`, { state: "failure", context: "ci/jenkins" });
  expect((await checks("tidy")).gate).toMatchObject({ ok: false, failed: ["ci/jenkins"] });
  expect((await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {})).status).toBe(409);

  await github(`/statuses/${SHA}`, { state: "success", context: "ci/jenkins" });
  expect((await checks("tidy")).gate).toMatchObject({ ok: true, passed: ["ci/jenkins"] });
  const m = await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {});
  expect(m.status).toBe(200);
  expect(await m.json()).toMatchObject({ status: "merged" });
});
