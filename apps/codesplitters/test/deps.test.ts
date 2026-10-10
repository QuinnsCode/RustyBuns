import { afterAll, describe, expect, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { bump, localFixer, outdated, scheduledDoctor, DEFAULTS, type Fixer, type Registry, type Tester } from "../src/deps.ts";
import { AgentSandbox, type ContainerApi } from "../src/sandbox.ts";
// @ts-expect-error plain .mjs, no types: it is the server inside the container image
import { depsTest as containerTest } from "../sandbox/server.mjs";

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const NOW = Date.UTC(2026, 9, 9);
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

/** A fake npm: each package's versions and how many days ago each came out. */
const registry = (pkgs: Record<string, Record<string, number>>): Registry => async (name) => {
  const v = pkgs[name];
  return v ? { versions: Object.keys(v), time: Object.fromEntries(Object.entries(v).map(([k, d]) => [k, daysAgo(d)])) } : null;
};

const NPM = registry({
  mitt: { "3.0.0": 400, "3.0.1": 100 },                  // in range for ^3.0.0: the lockfile's business
  kleur: { "3.0.0": 900, "4.1.5": 30 },                  // a major
  clsx: { "1.2.1": 500, "2.0.0": 60, "2.1.0": 1 },       // 2.1.0 is too fresh
  hono: { "4.0.0": 90, "4.6.0": 10, "5.0.0-rc.1": 5 },   // pinned; prereleases never count
  ky: { "1.0.0": 300, "2.0.0": 20 },                     // ignored
});

const PKG = `{
  "name": "lab",
  "scripts": { "test": "bun test" },
  "dependencies": {
    "mitt": "^3.0.0",
    "kleur": "^3.0.0",
    "clsx": "~1.2.1",
    "local": "workspace:*"
  },
  "devDependencies": {
    "hono": "4.0.0",
    "ky": "^1.0.0"
  }
}`;

test("outdated: only what the range doesn't allow, old enough, within the level, not ignored", async () => {
  const s = { ...DEFAULTS, max_level: "major" as const, ignore: ["ky"] };
  const { checked, updates } = await outdated(JSON.parse(PKG), s, NPM, NOW);
  expect(checked).toBe(4);
  expect(updates).toEqual([
    { name: "clsx", from: "~1.2.1", to: "~2.0.0", level: "major" },
    { name: "hono", from: "4.0.0", to: "4.6.0", level: "minor" },
    { name: "kleur", from: "^3.0.0", to: "^4.1.5", level: "major" },
  ]);
  const minor = await outdated(JSON.parse(PKG), { ...s, max_level: "minor" }, NPM, NOW);
  expect(minor.updates.map((u) => u.name)).toEqual(["hono"]);
});

test("bump edits only the version strings, keeping the file as written", () => {
  const out = bump(PKG.split("\n"), [{ name: "kleur", from: "^3.0.0", to: "^4.1.5" }]);
  expect(out.join("\n")).toBe(PKG.replace(`"kleur": "^3.0.0"`, `"kleur": "^4.1.5"`));
});

const COLOR = `import kleur from "kleur";\nexport const warn = (s: string) => kleur.red(s);\nexport const ok = (s: string) => kleur.green(s);\n`;

/** The fake test run: kleur 4 breaks the build. */
const kleurTester = (seen: string[][] = []): Tester => async (remote, files) => {
  expect(remote).toContain("://x:");
  const pkg = JSON.parse(files["package.json"]!);
  seen.push(Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).map(([k, v]) => `${k}@${v}`).filter((s) => /kleur|clsx|hono/.test(s)));
  return pkg.dependencies.kleur === "^4.1.5" ? { ok: false, out: "TypeError: kleur.red is not a function" } : { ok: true, out: "3 pass" };
};

async function app(tester?: Tester, fixer?: Fixer) {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  call.env.DEPS_REGISTRY = NPM;
  if (tester) call.env.DEPS_TESTER = tester;
  if (fixer) call.env.DEPS_FIXER = fixer;
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "package.json", content: PKG });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "src/paint.ts", content: COLOR.replace(/\n$/, "") });
  // Catalogue them, so the clone a test run takes has them.
  for (const path of ["package.json", "src/paint.ts"]) await send("ryan", `/api/repos/ryan/lab/do/commit?path=${path}`, { message: path });
  return { call, send };
}

const until = async (f: () => Promise<boolean>) => { for (let i = 0; i < 200 && !(await f()); i++) await Bun.sleep(20); };
const settle = async (call: (u: string, p: string) => Promise<Response>) => {
  let got: any;
  await until(async () => !(got = await (await call("ryan", "/api/repos/ryan/lab/deps")).json()).running);
  return got;
};

test("the owner tunes it and checks now: the updates land on a branch as agent-deps", async () => {
  const { call, send } = await app();
  expect((await call("ana", "/api/repos/ryan/lab/deps")).status).toBe(403);
  expect((await send("ryan", "/api/repos/ryan/lab/deps", { max_level: "huge" }, "PUT")).status).toBe(400);
  const s = await (await send("ryan", "/api/repos/ryan/lab/deps", { on: true, max_level: "major", min_age_days: 7, ignore: "ky, mitt" }, "PUT")).json();
  expect(s).toMatchObject({ on: true, max_level: "major", min_age_days: 7, ignore: ["ky", "mitt"], run_tests: false });

  const report = await (await send("ryan", "/api/repos/ryan/lab/deps/run", {})).json();
  expect(report.branch).toMatch(/^deps-\d{4}-\d{2}-\d{2}$/);
  expect(report.updates.map((u: any) => [u.name, u.to, u.status])).toEqual([["clsx", "~2.0.0", "untested"], ["hono", "4.6.0", "untested"], ["kleur", "^4.1.5", "untested"]]);

  const review = await (await call("ryan", `/api/repos/ryan/lab/branches/${report.branch}`)).json();
  expect(review.by).toBe("agent-deps");
  const ops = review.files[0].ops;
  expect(ops.length).toBe(3);
  const doc = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=package.json&branch=${report.branch}`)).json();
  const kleur = doc.lines.find((l: any) => l.text.includes("kleur"));
  expect(kleur).toMatchObject({ text: `    "kleur": "^4.1.5",`, by: "agent-deps" });
  // Main is untouched until someone merges.
  const main = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=package.json")).json();
  expect(main.lines.find((l: any) => l.text.includes("kleur")).text).toBe(`    "kleur": "^3.0.0",`);

  const again = await (await call("ryan", "/api/repos/ryan/lab/deps")).json();
  expect(again.report.branch).toBe(report.branch);
  expect(again.running).toBe(false);
});

test("with tests on, updates that break them are tried alone and left out", async () => {
  const seen: string[][] = [];
  const { call, send } = await app(kleurTester(seen));
  await send("ryan", "/api/repos/ryan/lab/deps", { max_level: "major", ignore: "ky", run_tests: true }, "PUT");
  const started = await send("ryan", "/api/repos/ryan/lab/deps/run", {});
  expect(started.status).toBe(202);
  expect((await send("ryan", "/api/repos/ryan/lab/deps/run", {})).status).toBe(409);
  let got: any;
  await until(async () => !(got = await (await call("ryan", "/api/repos/ryan/lab/deps")).json()).running);
  expect(got.report.updates.map((u: any) => [u.name, u.status])).toEqual([["clsx", "kept"], ["hono", "kept"], ["kleur", "broke"]]);
  expect(got.report.updates[2].out).toContain("kleur.red");
  // Together, then each alone, then the two that passed together once more.
  expect(seen.length).toBe(5);
  const doc = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=package.json&branch=${got.report.branch}`)).json();
  expect(doc.lines.map((l: any) => l.text).filter((t: string) => /clsx|hono|kleur/.test(t))).toEqual([`    "kleur": "^3.0.0",`, `    "clsx": "~2.0.0",`, `    "hono": "4.6.0",`]);
});

test("with a fixer on, an agent patches the call sites the update broke, on the same branch", async () => {
  const jobs: any[] = [];
  const fixer: Fixer = async (job) => {
    jobs.push(job);
    return { ok: true, tries: 2, out: "3 pass", edits: [
      { path: "src/paint.ts", before: COLOR, after: COLOR.replace(`import kleur from "kleur"`, `import { red, green } from "kleur/colors"`).replaceAll("kleur.", "") },
      { path: "src/colors.d.ts", before: null, after: `declare module "kleur/colors";\n` },
    ] };
  };
  const { call, send } = await app(kleurTester(), fixer);
  expect((await send("ryan", "/api/repos/ryan/lab/deps", { fix_with: "gpt" }, "PUT")).status).toBe(400);
  expect((await send("ryan", "/api/repos/ryan/lab/deps", { fix_with: "claude", fix_tries: 9 }, "PUT")).status).toBe(400);
  const s = await (await send("ryan", "/api/repos/ryan/lab/deps", { max_level: "major", ignore: "ky", run_tests: true, fix_with: "claude", fix_tries: 2 }, "PUT")).json();
  expect(s).toMatchObject({ fix_with: "claude", fix_tries: 2 });
  await send("ryan", "/api/repos/ryan/lab/deps/run", {});
  const got = await settle(call);

  // The agent got the broken update on top of the kept ones, and the failing output.
  expect(jobs.length).toBe(1);
  expect(jobs[0]).toMatchObject({ harness: "claude", tries: 2, out: expect.stringContaining("kleur.red"), update: { name: "kleur" } });
  expect(JSON.parse(jobs[0].files["package.json"]).dependencies).toMatchObject({ kleur: "^4.1.5", clsx: "~2.0.0" });
  const kleur = got.report.updates.find((u: any) => u.name === "kleur");
  expect(kleur).toMatchObject({ status: "fixed", fix: { by: "agent-claude", tries: 2, files: ["src/paint.ts", "src/colors.d.ts"] } });
  expect(kleur.out).toBeUndefined();

  const branch = got.report.branch;
  const pkg = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=package.json&branch=${branch}`)).json();
  expect(pkg.lines.find((l: any) => l.text.includes("kleur")).text).toBe(`    "kleur": "^4.1.5",`);
  const paint = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=src/paint.ts&branch=${branch}`)).json();
  expect(paint.lines.map((l: any) => [l.text, l.by])).toEqual([
    [`import { red, green } from "kleur/colors";`, "agent-claude"],
    ["export const warn = (s: string) => red(s);", "agent-claude"],
    ["export const ok = (s: string) => green(s);", "agent-claude"],
  ]);
  const dts = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=src/colors.d.ts&branch=${branch}`)).json();
  expect(dts.lines.map((l: any) => l.text)).toEqual([`declare module "kleur/colors";`]);
  // Main is untouched until someone merges.
  const main = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=src/paint.ts")).json();
  expect(main.lines[0].text).toBe(`import kleur from "kleur";`);
});

test("a fixer that gives up leaves the update out, with its last output", async () => {
  const fixer: Fixer = async () => ({ ok: false, tries: 3, out: "TypeError: red is not a function", edits: [] });
  const { call, send } = await app(kleurTester(), fixer);
  await send("ryan", "/api/repos/ryan/lab/deps", { max_level: "major", ignore: "ky", run_tests: true, fix_with: "pi" }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/deps/run", {});
  const got = await settle(call);
  const kleur = got.report.updates.find((u: any) => u.name === "kleur");
  expect(kleur).toMatchObject({ status: "broke", out: "TypeError: red is not a function", fix: { by: "agent-pi", tries: 3, files: [] } });
  const paint = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=src/paint.ts&branch=${got.report.branch}`)).json();
  expect(paint.lines[0].text).toBe(`import kleur from "kleur";`);
});

test("localFixer: the agent edits a real clone, the tests decide, and only its edits come back", async () => {
  const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "deps-fixer-test-"));
  try {
    const sh = (...cmd: string[]) => Bun.spawnSync(cmd, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    const pkg = `{ "name": "lab", "scripts": { "test": "bun test" } }\n`;
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "package.json"), pkg);
    writeFileSync(join(dir, "src/paint.ts"), `export const paint = (s: string) => "old:" + s; // kleur\n`);
    writeFileSync(join(dir, "src/gone.ts"), "export {};\n");
    writeFileSync(join(dir, "paint.test.ts"), `import { expect, test } from "bun:test";\nimport { paint } from "./src/paint.ts";\ntest("paints", () => expect(paint("x")).toBe("new:x"));\n`);
    sh("git", "init", "-q", "-b", "main"); sh("git", "add", "."); sh("git", "commit", "-qm", "use kleur");

    const prompts: string[] = [];
    // The fake agent: wrong on its first try, right on its second. It also adds a
    // file, deletes one and touches package.json, which the doctor owns.
    const exec = async (cmd: { args: string[] }, cwd: string) => {
      prompts.push(cmd.args[1]!);
      writeFileSync(join(cwd, "src/paint.ts"), `export const paint = (s: string) => "${prompts.length === 1 ? "nope" : "new"}:" + s; // kleur\n`);
      writeFileSync(join(cwd, "src/extra.ts"), "export const extra = 1;\n");
      writeFileSync(join(cwd, "package.json"), "{}");
      rmSync(join(cwd, "src/gone.ts"), { force: true });
      return { code: 0, out: "done" };
    };
    const update = { name: "kleur", from: "^3.0.0", to: "^4.1.5", level: "major" as const, status: "broke" as const };
    const r = await localFixer(exec)({ remote: dir, files: { "package.json": pkg }, update, out: "expected new:x", harness: "claude", tries: 3 });
    expect(r.ok).toBe(true);
    expect(r.tries).toBe(2);
    expect(prompts[0]).toContain("expected new:x");
    expect(prompts[0]).toContain("use kleur");          // the repo's history of the package
    expect(prompts[0]).toContain("src/paint.ts:1");     // where it's used
    expect(prompts[1]).toContain(`"new:x"`);            // the second try sees the first try's failure
    expect(r.edits.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "src/extra.ts", before: null, after: "export const extra = 1;\n" },
      { path: "src/paint.ts", before: `export const paint = (s: string) => "old:" + s; // kleur\n`, after: `export const paint = (s: string) => "new:" + s; // kleur\n` },
    ]);
    const gaveUp = await localFixer(async () => ({ code: 0, out: "" }))({ remote: dir, files: { "package.json": pkg }, update, out: "", harness: "pi", tries: 2 });
    expect(gaveUp).toMatchObject({ ok: false, tries: 2, edits: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

test("the schedule runs repos that are on and due, and skips the rest", async () => {
  const { call, send } = await app();
  await send("ryan", "/api/repos/ryan/lab/deps", { on: true, every_hours: 24 }, "PUT");
  const self = (r: Request) => call.env && (async () => (await import("../src/worker.ts")).default.fetch(r, call.env))();
  await scheduledDoctor(call.env, self, NOW);
  const first = await (await call("ryan", "/api/repos/ryan/lab/deps")).json();
  expect(first.last_run).toBe(NOW);
  expect(first.report.branch).toBe("deps-2026-10-09");
  await scheduledDoctor(call.env, self, NOW + 3_600_000);   // an hour later: not due
  expect((await (await call("ryan", "/api/repos/ryan/lab/deps")).json()).last_run).toBe(NOW);
  await scheduledDoctor(call.env, self, NOW + 25 * 3_600_000);
  expect((await (await call("ryan", "/api/repos/ryan/lab/deps")).json()).last_run).toBe(NOW + 25 * 3_600_000);
});

test("a scheduled run that runs out of time tests no further and branches only what passed", async () => {
  // Each fake test run takes 200ms, and kleur 4 breaks the build.
  const tester: Tester = async (_remote, files) => {
    await Bun.sleep(200);
    const pkg = JSON.parse(files["package.json"]!);
    return pkg.dependencies.kleur === "^4.1.5" ? { ok: false, out: "TypeError: kleur.red is not a function" } : { ok: true, out: "3 pass" };
  };
  const { call, send } = await app(tester);
  await send("ryan", "/api/repos/ryan/lab/deps", { on: true, max_level: "major", ignore: "ky", run_tests: true }, "PUT");
  const self = (r: Request) => (async () => (await import("../src/worker.ts")).default.fetch(r, call.env))();
  await scheduledDoctor(call.env, self, NOW, 0);   // no time at all: not even started
  expect((await (await call("ryan", "/api/repos/ryan/lab/deps")).json()).last_run).toBeNull();
  // Time for together and clsx alone, but not a third try.
  await scheduledDoctor(call.env, self, NOW, 500);
  const got = await (await call("ryan", "/api/repos/ryan/lab/deps")).json();
  expect(got.running).toBe(false);
  expect(got.report.updates.map((u: any) => [u.name, u.status])).toEqual([["clsx", "kept"], ["hono", "untested"], ["kleur", "untested"]]);
  expect(got.report.note).toContain("ran out of time");
  const doc = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=package.json&branch=${got.report.branch}`)).json();
  expect(doc.lines.map((l: any) => l.text).filter((t: string) => /clsx|hono|kleur/.test(t))).toEqual([`    "kleur": "^3.0.0",`, `    "clsx": "~2.0.0",`, `    "hono": "4.0.0",`]);
});

describe("on Cloudflare, tests run in an AGENT_SANDBOX container", () => {
  /** The app with AGENT_SANDBOX bound to fake containers whose server answers /deps-test with `server`. */
  async function hosted(server: (path: string, body: any) => { ok: boolean; out: string }) {
    const { call, send } = await app();
    call.env.ADMINS = "ryan";
    const seen: { path: string; body: any; env?: Record<string, string> }[] = [];
    call.env.ANTHROPIC_API_KEY = "sk-not-for-tests";
    call.env.AGENT_SANDBOX = {
      idFromName: (n: string) => n,
      get: () => {
        let running = false, started: Record<string, string> | undefined;
        const c: ContainerApi = {
          get running() { return running; },
          start(o) { running = true; started = o?.env; },
          async destroy() { running = false; },
          getTcpPort: () => ({ async fetch(url, init) {
            const body = JSON.parse(String(init!.body)), path = new URL(url).pathname;
            seen.push({ path, body, env: started });
            return Response.json(server(path, body));
          } }),
        };
        return new AgentSandbox({ container: c }, call.env);
      },
    };
    return { call, send, seen };
  }

  test("an admin's run: each try gets its own container with no logins, and the answer waits for it", async () => {
    const { call, send, seen } = await hosted((_p, b) => JSON.parse(b.files["package.json"]).dependencies.kleur === "^4.1.5" ? { ok: false, out: "kleur broke" } : { ok: true, out: "pass" });
    expect((await (await call("ryan", "/api/repos/ryan/lab/deps")).json()).can_test).toBe(true);
    await send("ryan", "/api/repos/ryan/lab/deps", { max_level: "major", ignore: "ky", run_tests: true }, "PUT");
    const res = await send("ryan", "/api/repos/ryan/lab/deps/run", {});
    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report.updates.map((u: any) => [u.name, u.status])).toEqual([["clsx", "kept"], ["hono", "kept"], ["kleur", "broke"]]);
    expect(seen.length).toBe(5);
    expect(seen.every((s) => s.path === "/deps-test" && s.body.remote.includes("://x:") && JSON.stringify(s.env) === "{}")).toBe(true);
  });

  test("an owner who isn't an admin gets no container: the updates go up untested", async () => {
    const { call, send, seen } = await hosted(() => ({ ok: true, out: "" }));
    call.env.ADMINS = "someone-else";
    expect((await (await call("ryan", "/api/repos/ryan/lab/deps")).json()).can_test).toBe(false);
    await send("ryan", "/api/repos/ryan/lab/deps", { max_level: "major", run_tests: true }, "PUT");
    const report = await (await send("ryan", "/api/repos/ryan/lab/deps/run", {})).json();
    expect(report.updates.every((u: any) => u.status === "untested")).toBe(true);
    expect(report.note).toContain("admins");
    expect(seen.length).toBe(0);
  });
});

describe("the container's /deps-test", () => {
  /** A one-commit repo on disk whose package.json has this test script. */
  async function repo(script: string) {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(`${tmpdir()}/deps-remote-`);
    writeFileSync(`${dir}/package.json`, JSON.stringify({ name: "r", scripts: { test: script } }));
    const git = (...a: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir });
    git("init", "-q"); git("add", "."); git("commit", "-qm", "init");
    return dir;
  }
  const pkg = (test?: string) => ({ "package.json": JSON.stringify({ name: "r", ...(test ? { scripts: { test } } : {}) }) });

  test("clones, swaps the files in, installs and runs the test script; the clone is gone after", async () => {
    const remote = await repo("exit 1");
    const passed = await containerTest({ remote, files: pkg("echo all-good") });
    expect(passed.ok).toBe(true);
    expect(passed.out).toContain("all-good");
    expect(passed.out).not.toContain(remote);
    expect((await containerTest({ remote, files: pkg("echo nope && exit 3") })).ok).toBe(false);
    expect((await containerTest({ remote, files: pkg() })).out).toContain("(no test script)");
  });

  test("a bad remote or a path out of the clone fails cleanly", async () => {
    expect((await containerTest({ remote: "/no/such/repo", files: {} })).ok).toBe(false);
    const r = await containerTest({ remote: await repo("true"), files: { "../escape": "x" } });
    expect(r).toEqual({ ok: false, out: "bad path: ../escape" });
  });
});
