import { afterAll, expect, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { bump, outdated, packageManager, parseNpmrc, registryUrl, scheduledDoctor, DEFAULTS, type Registry, type Tester } from "../src/deps.ts";

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

async function app(tester?: Tester, pkg = PKG) {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  call.env.DEPS_REGISTRY = NPM;
  if (tester) call.env.DEPS_TESTER = tester;
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "package.json", content: pkg });
  // Catalogue it, so the clone a test run takes has it.
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=package.json", { message: "package.json" });
  return { call, send };
}

const until = async (f: () => Promise<boolean>) => { for (let i = 0; i < 200 && !(await f()); i++) await Bun.sleep(20); };

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
  // The fake test run: kleur 4 breaks the build.
  const tester: Tester = async (remote, files) => {
    expect(remote).toContain("://x:");
    const pkg = JSON.parse(files["package.json"]!);
    seen.push(Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).map(([k, v]) => `${k}@${v}`).filter((s) => /kleur|clsx|hono/.test(s)));
    return pkg.dependencies.kleur === "^4.1.5" ? { ok: false, out: "TypeError: kleur.red is not a function" } : { ok: true, out: "3 pass" };
  };
  const { call, send } = await app(tester);
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

test("an .npmrc picks the registry per scope, and a token only goes to its own host", () => {
  const repo = parseNpmrc(`# the company's packages
@acme:registry=https://npm.acme.dev/api/
registry = "https://mirror.example/"
//npm.acme.dev/:_authToken=\${ACME_TOKEN}`);
  expect(repo).toEqual({ registry: "https://mirror.example/", scopes: { "@acme": "https://npm.acme.dev/api/" }, tokens: {} });   // no vars: the repo's file gets none
  const home = parseNpmrc("//npm.acme.dev/api/:_authToken=${ACME_TOKEN}\n//registry.npmjs.org/:_authToken=npm_x", { ACME_TOKEN: "s3cret" });
  expect(registryUrl([home, repo], "@acme/ui")).toEqual({ url: "https://npm.acme.dev/api/@acme%2fui", token: "s3cret" });
  expect(registryUrl([home, repo], "mitt")).toEqual({ url: "https://mirror.example/mitt" });
  expect(registryUrl([home], "mitt")).toEqual({ url: "https://registry.npmjs.org/mitt", token: "npm_x" });
});

test("the lockfile says which package manager, unless packageManager does", () => {
  expect(packageManager(["package.json", "pnpm-lock.yaml"], {})).toEqual({ pm: "pnpm", lock: "pnpm-lock.yaml" });
  expect(packageManager(["package-lock.json", "yarn.lock"], { packageManager: "yarn@4.5.0" })).toEqual({ pm: "yarn", lock: "yarn.lock" });
  expect(packageManager(["package.json"], {})).toEqual({ pm: "bun", lock: null });
});

test("workspaces are checked too, and the lockfile goes on the branch with them", async () => {
  const runs: { files: string[]; opts: any }[] = [];
  // The fake install: regenerates the lockfile from whatever package.jsons it was handed.
  const tester: Tester = async (_remote, files, opts) => {
    runs.push({ files: Object.keys(files).sort(), opts });
    return { ok: true, out: "", lock: `lockfileVersion: '9.0'\n${Object.entries(files).map(([p, t]) => `${p}: ${JSON.stringify(JSON.parse(t).dependencies ?? {})}`).sort().join("\n")}\n` };
  };
  const { call, send } = await app(tester, `{\n  "name": "lab",\n  "workspaces": ["apps/*"],\n  "dependencies": { "mitt": "^3.0.0" }\n}`);
  const files = {
    "apps/web/package.json": `{\n  "name": "@lab/web",\n  "dependencies": {\n    "kleur": "^3.0.0",\n    "lab": "^1.0.0"\n  }\n}`,
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\nold: true\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await send("ryan", "/api/repos/ryan/lab/files", { path, content });
    await send("ryan", `/api/repos/ryan/lab/do/commit?path=${path}`, { message: path });
  }
  await send("ryan", "/api/repos/ryan/lab/deps", { max_level: "major" }, "PUT");
  const report = await (await send("ryan", "/api/repos/ryan/lab/deps/run", {})).json();
  // mitt's update is in range; kleur's isn't; `lab` is the repo's own package, never the registry's.
  expect(report.updates.map((u: any) => [u.path, u.name, u.to])).toEqual([["apps/web/package.json", "kleur", "^4.1.5"]]);
  expect(report.lock).toBe("pnpm-lock.yaml");
  expect(runs).toEqual([{ files: ["apps/web/package.json"], opts: { pm: "pnpm", lock: "pnpm-lock.yaml", test: false } }]);
  const lock = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=pnpm-lock.yaml&branch=${report.branch}`)).json();
  expect(lock.lines.map((l: any) => l.text)).toEqual(["lockfileVersion: '9.0'", `apps/web/package.json: {"kleur":"^4.1.5","lab":"^1.0.0"}`, ""]);
  expect(lock.lines[0].by).toBe("ryan");   // an unchanged line keeps its author
  expect(lock.lines[1].by).toBe("agent-deps");
  const web = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=apps/web/package.json&branch=${report.branch}`)).json();
  expect(web.lines.find((l: any) => l.text.includes("kleur")).text).toBe(`    "kleur": "^4.1.5",`);
});
