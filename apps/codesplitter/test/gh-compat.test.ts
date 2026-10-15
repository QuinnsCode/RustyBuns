import { expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";
import { watchGithub } from "../src/checks.ts";
import { applyD1Migrations, d1 } from "@rustybuns/shell-bun";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SHA = "b".repeat(40);
const GH = "/api/gh/v3/repos/ryan/lab";

/** The app, a repo with a CI token, and a client that calls it the way a GitHub client would. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
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
  // The token's label names the CI in the checks pill.
  expect((await checks()).runs).toMatchObject([{ name: "ci/jenkins", runner: "external", runner_label: "jenkins", status: "running", sha: SHA, url: "https://ci.example/1" }]);

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

test("an external run waiting in the queue is never a bring-your-own runner's to claim", async () => {
  const { github, send, call } = await app();
  const queued = await (await github("/check-runs", { name: "test", head_sha: SHA, status: "queued" })).json() as any;
  expect((await send("ryan", "/api/repos/ryan/lab/checks/claim", { runner_label: "box-a" })).status).toBe(204);
  expect((await send("ryan", "/api/repos/ryan/lab/checks/claim", { runner_label: "box-a", names: ["test"] })).status).toBe(204);
  expect(await (await call("ryan", `/api/repos/ryan/lab/checks/${queued.id}`)).json()).toMatchObject({ runner: "external", status: "queued", runner_label: "jenkins" });   // the CI token's, not box-a
});

test("0043_ci_tokens widens check_runs.runner and keeps the rows, columns and indexes 0041_check_claims added", async () => {
  const all = join(import.meta.dir, "../migrations"), dir = mkdtempSync(join(tmpdir(), "cs-migrations-"));
  try {
    const files = readdirSync(all).filter((f) => f.endsWith(".sql")).sort();
    expect(files).toContain("0041_check_claims.sql");
    expect(files).toContain("0043_ci_tokens.sql");
    const db = d1();
    for (const f of files.filter((f) => f < "0042")) copyFileSync(join(all, f), join(dir, f));
    await applyD1Migrations(db, dir);
    const shape = () => ({
      columns: (db.sqlite.query("PRAGMA table_info(check_runs)").all() as { name: string }[]).map((c) => c.name).sort(),
      indexes: (db.sqlite.query("PRAGMA index_list(check_runs)").all() as { name: string }[]).map((i) => i.name).filter((n) => !n.startsWith("sqlite_")).sort(),
    });
    const before = shape();
    expect(before.columns).toContain("runner_label");
    expect(before.columns).toContain("heartbeat_at");
    expect(before.indexes).toEqual(["check_runs_by_ref", "check_runs_by_sha", "check_runs_queued"]);
    const add = db.sqlite.query(`INSERT INTO check_runs (owner, repo, ref, sha, name, runner, status, started_at, log, external_id, created_at, runner_label, heartbeat_at)
      VALUES ('ryan', 'lab', 'main', ?, ?, ?, ?, 5, 'log', NULL, 1, ?, ?)`);
    add.run(SHA, "test", "desktop", "running", "box-a", 123);
    add.run(SHA, "lint", "container", "queued", null, null);
    expect(() => add.run(SHA, "ci", "external", "running", null, null)).toThrow();
    const rows = () => db.sqlite.query("SELECT * FROM check_runs ORDER BY id").all();
    const had = rows();

    for (const f of files.filter((f) => f >= "0042" && f < "0044")) copyFileSync(join(all, f), join(dir, f));
    expect(await applyD1Migrations(db, dir)).toContain("0043_ci_tokens.sql");
    expect(shape()).toEqual(before);
    expect(rows()).toEqual(had);
    expect(rows()).toMatchObject([{ id: 1, runner_label: "box-a", heartbeat_at: 123 }, { id: 2, runner_label: null, heartbeat_at: null }]);
    add.run(SHA, "ci", "external", "running", null, null);
    expect(db.sqlite.query("SELECT runner FROM check_runs WHERE id = 3").get()).toEqual({ runner: "external" });
    expect(() => add.run(SHA, "x", "nope", "running", null, null)).toThrow();
    expect(db.sqlite.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each CI token counts against the ci rate limit, from the internet", async () => {
  const { call, send, made } = await app();
  await call.env.DB.prepare("INSERT INTO limit_rules (name, max, window_s, enabled, on_fail) VALUES ('ci', 2, 3600, 1, 'reject')").run();
  const report = (token: string, ip = "203.0.113.7") => call(null, `${GH}/statuses/${SHA}`, { method: "POST", headers: { authorization: `token ${token}`, "cf-connecting-ip": ip }, body: JSON.stringify({ state: "pending" }) });
  expect((await report(made.token)).status).toBe(201);
  expect((await report(made.token, "198.51.100.1")).status).toBe(201);
  const over = await report(made.token);
  expect(over.status).toBe(429);
  expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(await over.json()).toMatchObject({ message: expect.stringMatching(/ci reports is limited to 2 per hour/) });
  // Another token has its own count, and runs from the desktop and tests (no cf-connecting-ip) aren't counted.
  const other = await (await send("ryan", "/api/repos/ryan/lab/checks/tokens", { label: "circle" })).json() as { token: string };
  expect((await report(other.token)).status).toBe(201);
  expect((await call(null, `${GH}/statuses/${SHA}`, { method: "POST", headers: { authorization: `token ${made.token}` }, body: JSON.stringify({ state: "success" }) })).status).toBe(201);
});

test("CI tokens are MCP tools", async () => {
  const { call } = await app();
  const tools = (await (await call(null, "/api/mcp/tools")).json()) as { name: string; http: string }[];
  expect(tools.filter((t) => t.name.includes("ci_token")).map((t) => `${t.name} ${t.http}`).sort()).toEqual([
    "create_ci_token POST /api/repos/{owner}/{repo}/checks/tokens",
    "list_ci_tokens GET /api/repos/{owner}/{repo}/checks/tokens",
    "revoke_ci_token DELETE /api/repos/{owner}/{repo}/checks/tokens/{id}",
  ]);
});
