import { afterAll, expect, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { bump, outdated, scheduledDoctor, DEFAULTS, type Registry, type Tester } from "../src/deps.ts";

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

async function app(tester?: Tester) {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  call.env.DEPS_REGISTRY = NPM;
  if (tester) call.env.DEPS_TESTER = tester;
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "package.json", content: PKG });
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
