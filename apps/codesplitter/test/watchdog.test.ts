import { expect, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { FRESH, liveVersion, tick, type RolledBack, type WatchDeps } from "../src/watchdog-core.ts";

function world(live: string, healthy: boolean) {
  const w = { live, healthy, rolled: [] as string[], told: [] as RolledBack[], tellable: true };
  const deps: WatchDeps = {
    check: async () => w.healthy,
    active: async () => w.live,
    rollback: async (v) => { w.rolled.push(v); w.live = v; w.healthy = true; },
    report: async (r) => { if (w.tellable) w.told.push(r); return w.tellable; },
    now: () => 42,
  };
  return { w, deps };
}

test("a healthy version is remembered, and a bad deploy rolls back after N failures", async () => {
  const { w, deps } = world("v1", true);
  let s = (await tick(deps)).state;
  expect(s.good).toEqual(["v1"]);
  w.live = "v2"; w.healthy = false;
  const a = await tick(deps, s, 3); s = a.state;
  expect(a.outcome).toBe("failing");
  const b = await tick(deps, s, 3); s = b.state;
  expect(b.outcome).toBe("failing");
  s = (await tick(deps, s, 3)).state; // the third in a row rolls back
  expect(w.rolled).toEqual(["v1"]);
  expect(s.good).toEqual(["v1"]);
  expect(s.unreported).toEqual([{ from: "v2", to: "v1", at: 42 }]);
});

test("a blip below the threshold resets, and nothing rolls back", async () => {
  const { w, deps } = world("v1", true);
  let s = (await tick(deps)).state;
  w.healthy = false;
  s = (await tick(deps, s)).state;
  w.healthy = true;
  const r = await tick(deps, s);
  expect(r.state.fails).toBe(0);
  expect(w.rolled).toEqual([]);
});

test("a version that never passed is not rolled back to, and failing ones leave the good list", async () => {
  const { w, deps } = world("v1", false);
  let r = await tick(deps, { fails: 2, good: [] });
  expect(r.outcome).toBe("no-good-version");
  expect(w.rolled).toEqual([]);
  r = await tick(deps, { fails: 2, good: ["v1", "v0"] });
  expect(r.outcome).toBe("rolled-back");
  expect(w.rolled).toEqual(["v0"]);
  expect(r.state.good).toEqual(["v0"]);
});

test("a rollback is reported once the app answers, and kept until then", async () => {
  const { w, deps } = world("v1", true);
  w.tellable = false;
  let s = (await tick(deps, { fails: 0, good: ["v1"], unreported: [{ from: "v2", to: "v1", at: 1 }] })).state;
  expect(s.unreported).toHaveLength(1);
  w.tellable = true;
  s = (await tick(deps, s)).state;
  expect(s.unreported).toBeUndefined();
  expect(w.told).toHaveLength(1);
  expect(FRESH.good).toEqual([]);
});

test("liveVersion picks the version with the most traffic of the newest deployment", () => {
  expect(liveVersion({ result: { deployments: [{ versions: [{ version_id: "a", percentage: 10 }, { version_id: "b", percentage: 90 }] }, { versions: [{ version_id: "c", percentage: 100 }] }] } })).toBe("b");
  expect(() => liveVersion({ result: { deployments: [] } })).toThrow();
});

test("GET /api/health answers, and the rollback report needs the secret and a real repo", async () => {
  const call = await boot({ GH_CLI: "off", WATCHDOG_SECRET: "s3cret" });
  try {
    expect((await call(null, "/api/health")).status).toBe(200);
    const body = JSON.stringify({ repo: "ryan/lab", from: "v2", to: "v1" });
    const post = (headers?: Record<string, string>) => call(null, "/api/watchdog/rolled-back", { method: "POST", body, headers });
    expect((await post()).status).toBe(404);
    expect((await post({ authorization: "Bearer nope" })).status).toBe(404);
    await call("ryan", "/api/login", { method: "POST", body: JSON.stringify({ name: "ryan" }) });
    await call("ryan", "/api/repos", { method: "POST", body: JSON.stringify({ name: "lab", visibility: "public" }) });
    expect((await post({ authorization: "Bearer s3cret" })).status).toBe(200);
    expect((await call(null, "/api/watchdog/rolled-back", { method: "POST", body: "{}", headers: { authorization: "Bearer s3cret" } })).status).toBe(400);
  } finally { call.close(); }
});

test("a rollback is logged with the deploy and branch that shipped the bad version", async () => {
  const call = await boot({ GH_CLI: "off", WATCHDOG_SECRET: "s3cret" });
  try {
    await call("ryan", "/api/login", { method: "POST", body: JSON.stringify({ name: "ryan" }) });
    await call("ryan", "/api/repos", { method: "POST", body: JSON.stringify({ name: "lab", visibility: "public" }) });
    const db = call.env.DB;
    await db.prepare("INSERT INTO branches (owner, repo, name, by, status, created_at, merged_by, merged_at) VALUES ('ryan','lab','risky','agent-x','merged',1,'ryan',100)").run();
    await db.prepare("INSERT INTO deploys (id, owner, repo, stage, by, trigger, status, commit_hash, at) VALUES ('d1','ryan','lab','prod','ryan','button','done','abc123',200)").run();
    const res = await call(null, "/api/watchdog/rolled-back", { method: "POST", headers: { authorization: "Bearer s3cret" }, body: JSON.stringify({ repo: "ryan/lab", from: "v2", to: "v1", at: 300 }) });
    expect(res.status).toBe(200);
    const row = await db.prepare("SELECT deploy_id, commit_hash, branch, from_version, to_version FROM rollbacks WHERE owner = 'ryan'").first();
    expect(row).toMatchObject({ deploy_id: "d1", commit_hash: "abc123", branch: "risky", from_version: "v2", to_version: "v1" });
  } finally { call.close(); }
});

test("a rollback opens a fix task on a fresh branch off main, since the shipping branch is merged", async () => {
  const call = await boot({ GH_CLI: "off", WATCHDOG_SECRET: "s3cret", HEAL: "1" });
  try {
    call.env.AGENT_EXEC = (async () => ({ code: 0, out: "ok" })) as never;
    const send = (url: string, body: unknown) => call("ryan", url, { method: "POST", body: JSON.stringify(body) });
    await send("/api/login", { name: "ryan" });
    await send("/api/repos", { name: "lab" });
    await send("/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
    await send("/api/repos/ryan/lab/do/commit?path=a.ts", { message: "first" });
    const db = call.env.DB;
    await db.prepare("INSERT INTO branches (owner, repo, name, by, status, created_at, merged_by, merged_at) VALUES ('ryan','lab','risky','ryan','merged',1,'ryan',100)").run();
    await db.prepare("INSERT INTO branch_files (owner, repo, branch, path, merged) VALUES ('ryan','lab','risky','a.ts',1)").run();
    await db.prepare("INSERT INTO deploys (id, owner, repo, stage, by, trigger, status, commit_hash, at) VALUES ('d1','ryan','lab','prod','ryan','button','done','abc123',200)").run();
    const res = await call(null, "/api/watchdog/rolled-back", { method: "POST", headers: { authorization: "Bearer s3cret" }, body: JSON.stringify({ repo: "ryan/lab", from: "v2", to: "v1", at: 300 }) });
    expect(res.status).toBe(200);
    const body = await res.json() as { fix?: { branch: string; task: number } };
    expect(body.fix?.branch).toBe("rollback-v1");
    expect(await db.prepare("SELECT status FROM branches WHERE name = 'rollback-v1'").first()).toMatchObject({ status: "open" });
    expect(await db.prepare("SELECT path FROM branch_files WHERE branch = 'rollback-v1'").first()).toMatchObject({ path: "a.ts" });
  } finally { call.close(); }
});
