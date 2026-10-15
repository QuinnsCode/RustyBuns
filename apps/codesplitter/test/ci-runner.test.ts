import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local as boot } from "./app-kit.ts";
import { installFor, planFrom, workspacePatterns } from "../src/checks.ts";
import { CiRunner, drained } from "../src/ci-runner.ts";
import type { ContainerApi } from "../src/sandbox.ts";
import { gated, gateExports } from "./fake-gate.ts";
// @ts-expect-error plain .mjs, no types: it is the server inside the deploy and check images
import { exec, files } from "../deploy-sandbox/server.mjs";

// End to end, with real git and real bun test runs: past bun's 5s default on a busy machine.
setDefaultTimeout(30_000);

const MATH = 'import { expect, test } from "bun:test";\ntest("adds", () => expect(1 + 1).toBe(2));';

async function app(extra: Record<string, unknown> = {}) {
  const call = await boot({ GH_CLI: "off", ...extra });
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab" });
  const add = async (path: string, content: string) => {
    await send("ryan", "/api/repos/ryan/lab/files", { path, content });
    return (await (await send("ryan", `/api/repos/ryan/lab/do/commit?path=${encodeURIComponent(path)}`, { message: path })).json()).git?.commit as string;
  };
  const checks = async (ref = "main") => (await call("ryan", `/api/repos/ryan/lab/checks?ref=${ref}`)).json() as Promise<any>;
  /** The ref's runs once none is queued or running. */
  const settled = async (ref = "main") => {
    for (const end = performance.now() + 25_000; performance.now() < end; await Bun.sleep(20)) {
      const k = await checks(ref);
      if (k.runs.length && k.runs.every((r: any) => r.status !== "queued" && r.status !== "running")) return k;
    }
    throw new Error(`checks on ${ref} never finished: ${JSON.stringify((await checks(ref)).runs)}`);
  };
  const log = async (id: number) => (await (await call("ryan", `/api/repos/ryan/lab/checks/${id}`)).json()).log as string;
  return { call, send, add, checks, settled, log };
}

test("a monorepo's checks are per workspace, scoped to it and what it depends on (#750)", () => {
  const pkg = (o: object) => JSON.stringify(o);
  const root = pkg({ workspaces: ["packages/*", "./apps/*/"], scripts: { test: "bun test", typecheck: "bun scripts/typecheck.ts" } });
  expect(workspacePatterns(root)).toEqual(["packages/*", "apps/*"]);
  expect(workspacePatterns(pkg({ workspaces: { packages: ["libs/*"] } }))).toEqual(["libs/*"]);
  const ws = [
    { dir: "apps/a", pkg: pkg({ name: "a", scripts: { test: "bun test test", dev: "vite" }, dependencies: { "@x/ui": "workspace:*" } }) },
    { dir: "apps/b", pkg: pkg({ name: "b", scripts: { test: "bun test", typecheck: "tsc" } }) },
    { dir: "apps/it's", pkg: pkg({ scripts: { test: "bun test" } }) },
    { dir: "apps/example", pkg: pkg({ name: "example" }) },
    { dir: "packages/ui", pkg: pkg({ name: "@x/ui", devDependencies: { "@x/core": "*" } }) },
    { dir: "packages/core", pkg: pkg({ name: "@x/core" }) },
    { dir: "packages/empty", pkg: null },
  ];
  const lock = ["package.json", "bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "npm-shrinkwrap.json", "deno.lock"];
  // The root's test gives way to each workspace's; its typecheck stays, repo-wide.
  expect(planFrom(null, root, ws)).toEqual([
    { name: "apps/a:test", command: "cd 'apps/a' && bun run test", paths: ["apps/a", "packages/ui", "packages/core", ...lock] },
    { name: "apps/b:test", command: "cd 'apps/b' && bun run test", paths: ["apps/b", ...lock] },
    { name: "apps/b:typecheck", command: "cd 'apps/b' && bun run typecheck", paths: ["apps/b", ...lock] },
    { name: "apps/it's:test", command: "cd 'apps/it'\\''s' && bun run test", paths: ["apps/it's", ...lock] },
    { name: "typecheck", command: "bun run typecheck" },
  ]);
  // No workspace with scripts of its own: the root's, as before. A codesplitter.ci still wins.
  expect(planFrom(null, root, ws.slice(3))).toEqual([{ name: "test", command: "bun run test" }, { name: "typecheck", command: "bun run typecheck" }]);
  expect(planFrom(JSON.stringify({ lint: "biome check" }), root, ws)).toEqual([{ name: "lint", command: "biome check" }]);
  // With an install, every package.json check starts with it, at the root; a codesplitter.ci's runs as written (#775).
  const install = installFor(["package.json", "bun.lock"]);
  expect(install).toBe("bun install --frozen-lockfile");
  expect(installFor(["package.json", "package-lock.json"])).toBe("bun install");
  expect(planFrom(null, root, ws, install).map((p) => p.command)).toEqual([
    "bun install --frozen-lockfile && cd 'apps/a' && bun run test", "bun install --frozen-lockfile && cd 'apps/b' && bun run test",
    "bun install --frozen-lockfile && cd 'apps/b' && bun run typecheck", "bun install --frozen-lockfile && cd 'apps/it'\\''s' && bun run test",
    "bun install --frozen-lockfile && bun run typecheck",
  ]);
  expect(planFrom(null, root, ws.slice(3), "bun install")[0]).toEqual({ name: "test", command: "bun install && bun run test" });
  expect(planFrom(JSON.stringify({ lint: "biome check" }), root, ws, install)).toEqual([{ name: "lint", command: "biome check" }]);
});

test("a monorepo queues only the workspaces a branch touches, and main runs them all (#750)", async () => {
  const { call, send, add, checks } = await app();
  const edit = async (branch: string, path: string, text: string) => {
    const doc = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=${path}&branch=${branch}`)).json();
    await send("ryan", `/api/repos/ryan/lab/do/ops?path=${path}&branch=${branch}`, { ops: [{ kind: "set", line: doc.lines[0].id, text, base: doc.lines[0].rev }] });
  };
  await add("package.json", JSON.stringify({ workspaces: ["apps/*", "packages/*"] }));
  await add("apps/a/package.json", JSON.stringify({ name: "a", scripts: { test: "bun test" }, dependencies: { lib: "workspace:*" } }));
  await add("apps/b/package.json", JSON.stringify({ name: "b", scripts: { test: "bun test" } }));
  await add("apps/b/x.ts", "export const x = 1;");
  await add("packages/lib/package.json", JSON.stringify({ name: "lib" }));
  await add("packages/lib/index.ts", "export const y = 2;");
  const names = async (ref: string) => (await checks(ref)).runs.map((r: any) => r.name);

  await send("ryan", "/api/repos/ryan/lab/branches", { name: "in-b" });
  await edit("in-b", "apps/b/x.ts", "export const x = 2;");
  await send("ryan", "/api/repos/ryan/lab/checks/run", { ref: "in-b" });
  expect(await names("in-b")).toEqual(["apps/b:test"]);

  // A library a uses: a's tests, not b's.
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "in-lib" });
  await edit("in-lib", "packages/lib/index.ts", "export const y = 3;");
  await send("ryan", "/api/repos/ryan/lab/checks/run", { ref: "in-lib" });
  expect(await names("in-lib")).toEqual(["apps/a:test"]);

  // A new app on a branch is found there, before main has it.
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "new-app" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "apps/c/package.json", content: JSON.stringify({ scripts: { test: "bun test" } }), branch: "new-app" });
  await send("ryan", "/api/repos/ryan/lab/checks/run", { ref: "new-app" });
  expect(await names("new-app")).toEqual(["apps/c:test"]);

  await send("ryan", "/api/repos/ryan/lab/checks/run", { ref: "main" });
  expect(await names("main")).toEqual(["apps/a:test", "apps/b:test"]);
  const [first] = (await checks("main")).runs;
  // A fresh clone has no node_modules, so it installs first, at the root (#775).
  const command = async (ref: string) => (await (await call("ryan", `/api/repos/ryan/lab/checks/${(await checks(ref)).runs[0].id}`)).json()).command;
  expect(await command("main")).toBe("bun install && cd 'apps/a' && bun run test");
  // Frozen to bun's lockfile once the repo has one, a branch's own included.
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "locked" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "bun.lock", content: "{}", branch: "locked" });
  await send("ryan", "/api/repos/ryan/lab/checks/run", { ref: "locked" });
  expect(await command("locked")).toBe("bun install --frozen-lockfile && cd 'apps/a' && bun run test");
});

test("a commit's runs take the place of the ones still queued on an older commit (#750)", async () => {
  const { call, send, add, checks, log } = await app();
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "here" }, "PUT");
  const first = await add("a.ts", "one");
  const [old] = (await checks()).runs;
  expect(old).toMatchObject({ sha: first, status: "queued" });
  const second = await add("b.ts", "two");
  expect((await checks()).runs).toMatchObject([{ sha: second, status: "queued" }]);
  expect(await (await call("ryan", `/api/repos/ryan/lab/checks/${old.id}`)).json()).toMatchObject({ status: "cancelled" });
  expect(await log(old.id)).toContain(`${second.slice(0, 12)} came along before a runner did: cancelled`);
});

test("the desktop runs its own queue: a commit's check and a branch's edit run here with nobody starting a runner (#750)", async () => {
  const { call, send, add, settled, log } = await app({ CHECKS_RUNNER: undefined });
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "here", required: [{ name: "test", command: "bun test ./math.test.ts" }] }, "PUT");
  const sha = await add("math.test.ts", MATH);
  const k = await settled();
  expect(k.runs).toMatchObject([{ name: "test", sha, status: "passed" }]);
  expect(k.runs[0].runner_label).toMatch(/^desktop@/);
  expect(await log(k.runs[0].id)).toContain("1 pass");
  expect(k.gate.ok).toBe(true);

  // An edit on a branch not pushed: main with the branch's file over it, run as soon as it's queued.
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "oops" });
  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=math.test.ts&branch=oops")).json();
  await send("ryan", "/api/repos/ryan/lab/do/ops?path=math.test.ts&branch=oops", { ops: [{ kind: "set", line: doc.lines[1].id, text: 'test("adds", () => expect(1 + 1).toBe(3));', base: doc.lines[1].rev }] });
  const b = await settled("oops");
  expect(b.runs).toMatchObject([{ name: "test", status: "failed" }]);
  expect(b.sha).toMatch(/^oops@\d+$/);
  const out = await log(b.runs[0].id);
  expect(out).toContain("main, with 1 file from branch oops as they are now");
  expect(out).toContain("1 fail");
  await drained("ryan", "lab");
});

test("the desktop's checks get none of the owner's logins: a scrubbed env and an empty HOME of their own (#1010)", async () => {
  const { send, add, settled, log } = await app({ CHECKS_RUNNER: undefined });
  process.env.CS_FAKE_LOGIN = "hunter2";
  try {
    await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "here", required: [{ name: "env", command: 'echo "login=${CS_FAKE_LOGIN:-none} ci=$CI files=$(ls -A "$HOME" | wc -l | tr -d " ")"; echo "home=$HOME"' }] }, "PUT");
    await add("a.ts", "one");
    const k = await settled();
    expect(k.runs).toMatchObject([{ name: "env", status: "passed" }]);
    const out = await log(k.runs[0].id);
    expect(out).toContain("login=none ci=1 files=0");
    expect(out).not.toContain(`home=${process.env.HOME}\n`);
    expect(out).toMatch(/home=\S+\/home\n/);
  } finally {
    delete process.env.CS_FAKE_LOGIN;
  }
  await drained("ryan", "lab");
});

/** A CiRunner per repo whose container is real: server.mjs's own exec and files, in a temp dir. Its alarms run one at a time, as the runtime's do. */
function ciNamespace(env: any) {
  const seen = { lists: [] as string[][], env: [] as (Record<string, string> | undefined)[], internet: [] as (boolean | undefined)[], destroyed: 0, ran: [] as string[] };
  const objects = new Map<string, CiRunner>();
  let idle: Promise<void> = Promise.resolve();
  const container = (): ContainerApi => {
    let root = "";
    return gated<ContainerApi>({
      get running() { return !!root; },
      start(o) { root = mkdtempSync(join(tmpdir(), "cs-ci-box-")); seen.env.push(o?.env); seen.internet.push(o?.enableInternet); },
      async destroy() { if (root) rmSync(root, { recursive: true, force: true }); root = ""; seen.destroyed++; },
      getTcpPort: () => ({
        async fetch(u, init) {
          const body = JSON.parse(String(init!.body));
          if (String(u).endsWith("/files")) return Response.json(await files(body, root));
          seen.ran.push(body.cmd.join(" "));
          const lines: string[] = [];
          const { code } = await exec(body, root, 60_000, (out: string) => lines.push(JSON.stringify({ out })));
          return new Response([...lines, JSON.stringify({ code })].join("\n") + "\n");
        },
      }),
    }, seen.lists).container;
  };
  const ns = {
    idFromName: (n: string) => n,
    get(id: string) {
      if (!objects.has(id)) {
        const data = new Map<string, unknown>();
        let due = false, busy = false;
        const ring = async () => { busy = true; while (due) { due = false; await obj.alarm(); } busy = false; };
        const obj: CiRunner = new CiRunner({
          container: container(), exports: gateExports,
          storage: {
            get: async (k: string) => structuredClone(data.get(k)) as any,
            put: async (k: string, v: unknown) => { data.set(k, structuredClone(v)); },
            setAlarm: async () => { due = true; if (!busy) idle = ring(); },
          },
        }, env);
        objects.set(id, obj);
      }
      return objects.get(id)!;
    },
  };
  return { ns, seen, idle: () => idle };
}

test("with CI_RUNNER bound, queued checks run in a container of their own, with no secrets and only the clone and registries to reach (#750)", async () => {
  const holder = { ci: null as ReturnType<typeof ciNamespace> | null };
  const { call, send, add, settled, log } = await app({ CI_RUNNER: { get: (id: string) => holder.ci!.ns.get(id), idFromName: (n: string) => n } });
  holder.ci = ciNamespace(call.env);
  const { seen } = holder.ci;
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "here", required: [{ name: "test", command: 'bun test ./math.test.ts && echo "ci=$CI"' }] }, "PUT");
  const sha = await add("math.test.ts", MATH);
  const k = await settled();
  expect(k.runs).toMatchObject([{ name: "test", sha, runner: "container", status: "passed", runner_label: "codesplitter container" }]);
  const out = await log(k.runs[0].id);
  expect(out).toContain("1 pass");
  expect(out).toContain("ci=1");
  expect(seen.env).toEqual([{ CI: "1" }]);
  expect(seen.internet).toEqual([false]);
  expect(seen.lists[0]).toEqual(["127.0.0.1", "registry.npmjs.org", "registry.yarnpkg.com", "repo.yarnpkg.com"]);
  expect(seen.ran[0]).toStartWith("git clone --quiet http://");
  expect(seen.destroyed).toBeGreaterThanOrEqual(1);
  await holder.ci.idle();
});

test("container checks count against the owner's `checks` limit: one over it is cancelled, saying why (#750)", async () => {
  const holder = { ci: null as ReturnType<typeof ciNamespace> | null };
  const { call, send, add, settled, log } = await app({ CI_RUNNER: { get: (id: string) => holder.ci!.ns.get(id), idFromName: (n: string) => n } });
  holder.ci = ciNamespace(call.env);
  await call.env.DB.prepare("INSERT INTO limit_rules (name, max, window_s, enabled, on_fail) VALUES ('checks', 1, 3600, 1, 'reject')").run();
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "here", required: [{ name: "test", command: "true" }] }, "PUT");
  await add("a.ts", "one");
  expect((await settled()).runs).toMatchObject([{ status: "passed" }]);
  await add("b.ts", "two");
  const k = await settled();
  expect(k.runs).toMatchObject([{ status: "cancelled" }]);
  expect(await log(k.runs[0].id)).toContain("Slow down: container checks is limited to 1 per hour");
  expect(holder.ci.seen.env).toHaveLength(1);   // the second never started a container
  await holder.ci.idle();
});

test("container minutes come off one daily budget for the site, admins' runs included: a spent one cancels the run before a container starts (#797)", async () => {
  const holder = { ci: null as ReturnType<typeof ciNamespace> | null };
  const { call, send, add, settled, log } = await app({ ADMINS: "ryan", CI_RUNNER: { get: (id: string) => holder.ci!.ns.get(id), idFromName: (n: string) => n } });
  holder.ci = ciNamespace(call.env);
  await call.env.DB.prepare("INSERT INTO limit_rules (name, max, window_s, enabled, on_fail) VALUES ('containers', 1, 86400, 1, 'reject')").run();
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "here", required: [{ name: "test", command: "true" }] }, "PUT");
  await add("a.ts", "one");
  expect((await settled()).runs).toMatchObject([{ status: "passed" }]);
  await add("b.ts", "two");
  const k = await settled();
  expect(k.runs).toMatchObject([{ status: "cancelled" }]);
  expect(await log(k.runs[0].id)).toContain("The site's container minutes for the day are used up (1).");
  expect(holder.ci.seen.env).toHaveLength(1);
  await holder.ci.idle();
});

test("a check that needs Rust is queued for the desktop up front; one that hits a missing tool in the container is handed over, not failed (#1689)", async () => {
  const holder = { ci: null as ReturnType<typeof ciNamespace> | null };
  const { call, send, add, checks, settled, log } = await app({ CI_RUNNER: { get: (id: string) => holder.ci!.ns.get(id), idFromName: (n: string) => n } });
  holder.ci = ciNamespace(call.env);
  await send("ryan", "/api/repos/ryan/lab/checks/settings", { where: "here", required: [{ name: "native", command: "cargo test" }, { name: "late", command: "echo 'sh: 1: docker: not found'; exit 127" }] }, "PUT");
  await add("math.test.ts", MATH);
  for (let end = performance.now() + 25_000; performance.now() < end; await Bun.sleep(20)) {
    const runs = (await checks()).runs as any[];
    if (runs.length === 2 && runs.every((r) => r.runner === "desktop" && r.status === "queued")) break;
  }
  const runs = (await checks()).runs as any[];
  expect(runs.map((r) => [r.name, r.runner, r.status]).sort()).toEqual([["late", "desktop", "queued"], ["native", "desktop", "queued"]]);
  expect(await log(runs.find((r) => r.name === "native").id)).toContain("Needs Rust. Hosted checks don't have it.");
  const late = await log(runs.find((r) => r.name === "late").id);
  expect(late).toContain("docker: not found");
  expect(late).toContain("Needs desktop");
  // The listing flags both so the pill says "needs desktop", not a plain queued.
  expect(runs.map((r) => !!r.needs_desktop)).toEqual([true, true]);
  await holder.ci.idle();
  void settled;
});
