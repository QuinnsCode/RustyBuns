import { afterAll, describe, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { bump, costOf, fixCommand, fixPrompt, localFixer, npmrcHosts, osvAdvisories, outdated, packageManager, parseNpmrc, registryUrl, runDoctor, scheduledDoctor, whatsNew, DEFAULTS, MAX_WATCHED, type Advisories, type Fixer, type Notify, type Registry, type Report, type Tester, type Update, type Vuln } from "../src/deps.ts";
import { AgentSandbox, type ContainerApi } from "../src/sandbox.ts";
import { gated } from "./fake-gate.ts";
// @ts-expect-error plain .mjs, no types: it is the server inside the container image
import { depsFix as containerFix, depsTest as containerTest } from "../sandbox/server.mjs";

// These run the app end to end (real git, password hashes, in-process D1): fine alone,
// but a full run on a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

// The app reads the real clock, so the fake releases are dated from it too.
const NOW = Date.now();
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

test("outdated: below 1.0 the leftmost non-zero part is the major, as semver has it", async () => {
  const npm = registry({
    tiny: { "0.0.599": 400, "0.0.617": 100 },              // any 0.0.x change breaks
    exact: { "0.0.1929": 400, "0.0.2112": 100 },
    zero: { "0.3.1": 400, "0.4.0": 100 },                  // a 0.x minor breaks
    near: { "0.3.1": 400, "0.3.2": 100 },                  // a 0.x patch may add things
    one: { "1.2.3": 400, "1.2.4": 100 },
  });
  const pkg = { dependencies: { tiny: "^0.0.599", exact: "0.0.1929", zero: "~0.3.1", near: "0.3.1", one: "1.2.3" } };
  const all = await outdated(pkg, { ...DEFAULTS, max_level: "major", ignore: [] }, npm, NOW);
  expect(Object.fromEntries(all.updates.map((u) => [u.name, u.level]))).toEqual({ exact: "major", near: "minor", one: "patch", tiny: "major", zero: "major" });
  const patch = await outdated(pkg, { ...DEFAULTS, max_level: "patch", ignore: [] }, npm, NOW);
  expect(patch.updates.map((u) => u.name)).toEqual(["one"]);
  const minor = await outdated(pkg, { ...DEFAULTS, max_level: "minor", ignore: [] }, npm, NOW);
  expect(minor.updates.map((u) => u.name)).toEqual(["near", "one"]);
});

test("outdated: a vulnerable version moves to its first fix, past the level and the minimum age", async () => {
  const npm = registry({
    mitt: { "3.0.0": 400, "3.0.1": 1, "3.0.2": 0 },     // the fix is a day old and inside the range
    kleur: { "3.0.0": 900, "4.1.5": 30 },               // fixed only in a major
    clsx: { "1.2.1": 500 },                             // no fix yet
    hono: { "4.0.0": 90, "4.6.0": 10 },                 // the usual update already has the fix
    ky: { "1.0.0": 300, "1.0.1": 200 },                 // ignored, so only reported
  });
  const v = (id: string, ...fixed: string[]): Vuln => ({ id, summary: "", fixed });
  const vulns = new Map([
    ["mitt@3.0.0", [v("GHSA-mitt", "2.0.9", "3.0.1")]],
    ["kleur@3.0.0", [v("GHSA-kleur", "4.1.5")]],
    ["clsx@1.2.1", [v("GHSA-clsx")]],
    ["hono@4.0.0", [v("GHSA-hono", "4.2.0")]],
    ["ky@1.0.0", [v("GHSA-ky", "1.0.1")]],
  ]);
  const { updates, exposed } = await outdated(JSON.parse(PKG), { ...DEFAULTS, max_level: "minor", ignore: ["ky"] }, npm, NOW, vulns);
  expect(updates).toEqual([
    { name: "hono", from: "4.0.0", to: "4.6.0", level: "minor", fixes: ["GHSA-hono"] },
    { name: "kleur", from: "^3.0.0", to: "^4.1.5", level: "major", fixes: ["GHSA-kleur"] },
    { name: "mitt", from: "^3.0.0", to: "^3.0.1", level: "patch", fixes: ["GHSA-mitt"] },
  ]);
  expect(exposed).toEqual([{ name: "clsx", version: "1.2.1", ids: ["GHSA-clsx"] }, { name: "ky", version: "1.0.0", ids: ["GHSA-ky"] }]);
});

test("osvAdvisories asks osv.dev in one batch, then each hit's fixed versions for that package", async () => {
  const asked: string[] = [];
  const get = (async (url: string, init?: RequestInit) => {
    asked.push(url);
    if (url.endsWith("/querybatch")) {
      const { queries } = JSON.parse(String(init!.body));
      expect(queries[0]).toEqual({ package: { name: "mitt", ecosystem: "npm" }, version: "3.0.0" });
      return Response.json({ results: [{ vulns: [{ id: "GHSA-1" }] }, {}] });
    }
    return Response.json({ id: "GHSA-1", summary: "prototype pollution", affected: [
      { package: { ecosystem: "npm", name: "mitt" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "3.0.1" }] }] },
      { package: { ecosystem: "npm", name: "other" }, ranges: [{ type: "SEMVER", events: [{ fixed: "9.9.9" }] }] },
    ] });
  }) as typeof fetch;
  const got = await osvAdvisories(get)([{ name: "mitt", version: "3.0.0" }, { name: "kleur", version: "3.0.0" }]);
  expect([...got]).toEqual([["mitt@3.0.0", [{ id: "GHSA-1", summary: "prototype pollution", fixed: ["3.0.1"] }]]]);
  expect(asked).toEqual(["https://api.osv.dev/v1/querybatch", "https://api.osv.dev/v1/vulns/GHSA-1"]);
});

test("a run reports what no update fixes, and goes on when osv.dev is down", async () => {
  const hit: Advisories = async () => new Map([["kleur@3.0.0", [{ id: "GHSA-k", summary: "", fixed: [] }]]]);
  const { send } = await app(undefined, undefined, PKG, { advisories: hit });
  await send("ryan", "/api/repos/ryan/lab/deps", { max_level: "patch", ignore: "ky" }, "PUT");
  const report = await (await send("ryan", "/api/repos/ryan/lab/deps/run", {})).json();
  expect(report.exposed).toEqual([{ name: "kleur", version: "3.0.0", ids: ["GHSA-k"], path: "package.json" }]);
  expect(report.note).toContain("1 dependency has a known vulnerability");

  const down = await app(undefined, undefined, PKG, { advisories: (async () => { throw new Error("503"); }) as Advisories });
  await down.send("ryan", "/api/repos/ryan/lab/deps", { max_level: "minor", ignore: "ky" }, "PUT");
  const r2 = await (await down.send("ryan", "/api/repos/ryan/lab/deps/run", {})).json();
  expect(r2.branch).toBeTruthy();
  expect(r2.note).toContain("couldn't check for known vulnerabilities (503)");
});

test("whatsNew: only advisories and branch fixes the owner wasn't told about", () => {
  const report = (exposed: string[], fixes: string[], status: Update["status"] = "untested"): Report => ({
    at: 0, checked: 2, branch: fixes.length ? "deps-x" : undefined,
    exposed: exposed.length ? [{ name: "clsx", version: "1.2.1", ids: exposed, path: "package.json" }] : undefined,
    updates: fixes.length ? [{ name: "mitt", from: "^3.0.0", to: "^3.0.1", level: "patch", status, fixes, path: "package.json" }] : [],
  });
  const first = whatsNew([], report(["GHSA-a"], ["GHSA-m"]));
  expect(first.exposed.map((x) => x.ids)).toEqual([["GHSA-a"]]);
  expect(first.fixes.map((u) => u.name)).toEqual(["mitt"]);
  // The same again (the branch wasn't merged): nothing new.
  const same = whatsNew(first.seen, report(["GHSA-a"], ["GHSA-m"]));
  expect([same.exposed, same.fixes]).toEqual([[], []]);
  // A second advisory on the same version is news; the first isn't.
  expect(whatsNew(first.seen, report(["GHSA-a", "GHSA-b"], [])).exposed.map((x) => x.ids)).toEqual([["GHSA-b"]]);
  // Gone, then back: news again.
  const gone = whatsNew(first.seen, report([], []));
  expect(whatsNew(gone.seen, report(["GHSA-a"], [])).exposed.length).toBe(1);
  // A fix whose update broke the tests didn't go on the branch.
  expect(whatsNew([], report([], ["GHSA-m"], "broke")).fixes).toEqual([]);
});

test("a run alerts the owner once about what's new, and a failed run forgets nothing", async () => {
  let advisories: Advisories = async () => new Map([["kleur@3.0.0", [{ id: "GHSA-k", summary: "", fixed: [] }]]]);
  const { call, send } = await app(undefined, undefined, PKG, { advisories: ((pkgs) => advisories(pkgs)) as Advisories });
  const told: { owner: string; subject: string; lines: string[] }[] = [];
  call.env.DEPS_NOTIFY = (async (owner, subject, lines) => { told.push({ owner, subject, lines }); }) satisfies Notify;
  await send("ryan", "/api/repos/ryan/lab/deps", { max_level: "patch", ignore: "ky" }, "PUT");
  const run = async () => (await send("ryan", "/api/repos/ryan/lab/deps/run", {})).json();

  await run();
  expect(told.length).toBe(1);
  expect(told[0]).toMatchObject({ owner: "ryan", subject: "ryan/lab: a dependency is exposed" });
  expect(told[0]!.lines.join("\n")).toContain("kleur@3.0.0: GHSA-k");
  await run();
  expect(told.length).toBe(1);

  // A run that fails knows nothing new: no alert, and the next good one still remembers.
  const failed = await runDoctor(call.env, async () => { throw new Error("down"); }, "ryan", "lab");
  expect(failed.note).toBe("failed: down");
  expect(told.length).toBe(1);
  await run();
  expect(told.length).toBe(1);

  // A security fix that lands on a branch is news.
  advisories = async () => new Map([["hono@4.0.0", [{ id: "GHSA-h", summary: "", fixed: ["4.6.0"] }]]]);
  const r = await run();
  expect(r.branch).toBeTruthy();
  expect(told.length).toBe(2);
  expect(told[1]!.subject).toBe(`ryan/lab: security fixes on ${r.branch}`);
  expect(told[1]!.lines.join("\n")).toContain("hono 4.0.0 → 4.6.0: GHSA-h");
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

async function app(tester?: Tester, fixer?: Fixer, pkg = PKG, extra: Record<string, unknown> = {}) {
  const { advisories, ...env } = extra;
  const call = await boot({ GH_CLI: "off", ...env });
  opened.push(call);
  call.env.DEPS_REGISTRY = NPM;
  call.env.DEPS_ADVISORIES = (advisories as Advisories | undefined) ?? (async () => new Map());
  if (tester) call.env.DEPS_TESTER = tester;
  if (fixer) call.env.DEPS_FIXER = fixer;
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "package.json", content: pkg });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "src/paint.ts", content: COLOR.replace(/\n$/, "") });
  // Catalogue them, so the clone a test run takes has them.
  for (const path of ["package.json", "src/paint.ts"]) await send("ryan", `/api/repos/ryan/lab/do/commit?path=${path}`, { message: path });
  return { call, send };
}

const until = async (f: () => Promise<boolean>) => { for (const end = performance.now() + 15_000; performance.now() < end && !(await f());) await Bun.sleep(20); };
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
  // codex runs shell commands, in a clone with the repo's code installed, next to its login (#683).
  expect((await send("ryan", "/api/repos/ryan/lab/deps", { fix_with: "codex" }, "PUT")).status).toBe(400);
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

test("the on-fail chain: the owner orders the steps, and the first that works settles each update (#861)", async () => {
  // clsx 2 and kleur 4 both break; clsx has a 1.3.0 to roll back to, kleur nothing smaller than its major.
  const tester: Tester = async (_remote, files) => {
    const deps = JSON.parse(files["package.json"]!).dependencies;
    return deps.clsx === "~2.0.0" || deps.kleur === "^4.1.5" ? { ok: false, out: `broke with ${deps.clsx} ${deps.kleur}` } : { ok: true, out: "pass" };
  };
  const jobs: any[] = [];
  const fixer: Fixer = async (job) => { jobs.push(job); return { ok: false, tries: 1, out: "still broken", edits: [], usd: 0.25 }; };
  const { call, send } = await app(tester, fixer);
  call.env.DEPS_REGISTRY = registry({ ...{ mitt: { "3.0.0": 400 }, hono: { "4.0.0": 90 }, ky: { "1.0.0": 300 } }, kleur: { "3.0.0": 900, "4.1.5": 30 }, clsx: { "1.2.1": 500, "1.3.0": 200, "2.0.0": 60 } });
  const put = (b: unknown) => send("ryan", "/api/repos/ryan/lab/deps", b, "PUT");
  expect((await put({ on_fail: ["retry", "pray"] })).status).toBe(400);
  expect((await put({ on_fail: ["retry", "retry"] })).status).toBe(400);
  expect((await put({ chain_tries: 0 })).status).toBe(400);
  expect((await put({ chain_usd: 99 })).status).toBe(400);
  expect((await put({ held: "kleur" })).status).toBe(400);
  const s = await (await put({ max_level: "major", ignore: "ky", run_tests: true, fix_with: "claude", fix_tries: 3, on_fail: "retry, fix, rollback, hold, alert", chain_tries: 6, chain_usd: 2 })).json();
  expect(s).toMatchObject({ on_fail: ["retry", "fix", "rollback", "hold", "alert"], chain_tries: 6, chain_minutes: 30, chain_usd: 2, held: [] });

  await send("ryan", "/api/repos/ryan/lab/deps/run", {});
  const got = await settle(call);
  const by = Object.fromEntries(got.report.updates.map((u: any) => [u.name, u]));
  // clsx: the retry and the fix didn't work, the roll back to 1.3.0 did.
  expect(by.clsx).toMatchObject({ status: "kept", to: "~1.3.0", level: "minor", was: "~2.0.0" });
  expect(by.clsx.chain).toEqual([{ step: "retry", ok: false }, { step: "fix", ok: false, usd: 0.25 }, { step: "rollback", ok: true }]);
  // kleur: nothing smaller to roll back to, so it's held back, and the chain stops before the alert.
  expect(by.kleur.status).toBe("held");
  expect(by.kleur.chain.map((c: any) => [c.step, c.ok])).toEqual([["retry", false], ["fix", false], ["rollback", false], ["hold", true]]);
  // The fixer got what's left of the chain's tries and dollars.
  expect(jobs.map((j) => [j.update.name, j.tries, j.usd])).toEqual([["clsx", 3, 2], ["kleur", 3, 2]]);
  const pkg = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=package.json&branch=${got.report.branch}`)).json();
  expect(pkg.lines.map((l: any) => l.text).filter((t: string) => /clsx|kleur/.test(t))).toEqual([`    "kleur": "^3.0.0",`, `    "clsx": "~1.3.0",`]);

  // Held back: the next run doesn't propose that release again.
  expect((await (await call("ryan", "/api/repos/ryan/lab/deps")).json()).settings.held).toEqual(["kleur@4.1.5"]);
  await send("ryan", "/api/repos/ryan/lab/deps/run", {});
  expect((await settle(call)).report.updates.map((u: any) => u.name)).not.toContain("kleur");
});

test("the on-fail chain stops spending at its dollar cap, and its alert tells the owner once", async () => {
  const fixer: Fixer = async () => ({ ok: false, tries: 2, out: "TypeError: red is not a function", edits: [], usd: 0.6 });
  const { call, send } = await app(kleurTester(), fixer);
  const told: string[] = [];
  call.env.DEPS_NOTIFY = (async (_owner, subject, lines) => { told.push([subject, ...lines].join("\n")); }) satisfies Notify;
  await send("ryan", "/api/repos/ryan/lab/deps", { max_level: "major", ignore: "ky", run_tests: true, fix_with: "claude", on_fail: ["fix", "search", "alert"], chain_usd: 0.5 }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/deps/run", {});
  const kleur = (await settle(call)).report.updates.find((u: any) => u.name === "kleur");
  expect(kleur.status).toBe("broke");
  expect(kleur.chain).toEqual([{ step: "fix", ok: false, usd: 0.6 }, { step: "search", ok: false, note: "out of dollars" }, { step: "alert", ok: true }]);
  expect(told.length).toBe(1);
  expect(told[0]).toContain("ryan/lab: an update breaks the tests");
  expect(told[0]).toContain("kleur ^3.0.0 → ^4.1.5: tried fix, search");
  await send("ryan", "/api/repos/ryan/lab/deps/run", {});
  await settle(call);
  expect(told.length).toBe(1);
});

test("the 🔎 step: claude gets web search and a prompt to look for known breakage; every claude try says its cost", () => {
  const u: Update = { name: "vite", from: "^6.0.0", to: "^7.0.0", level: "major", status: "broke" };
  const plain = fixCommand("claude", fixPrompt(u, 3)), search = fixCommand("claude", fixPrompt(u, 3, true), true);
  expect(plain.args[plain.args.indexOf("--tools") + 1]).toBe("Read,Edit,Write,Glob,Grep");
  expect(search.args[search.args.indexOf("--tools") + 1]).toBe("Read,Edit,Write,Glob,Grep,WebSearch");
  expect(search.args.slice(-2)).toEqual(["--output-format", "json"]);
  expect(search.args[1]).toContain("search the web for known breakage in this release: an issue, release note or migration guide about vite@7.0.0");
  expect(plain.args[1]).not.toContain("search the web");
  expect(fixCommand("pi", "x").args).not.toContain("--output-format");
  expect(costOf(`{"type":"result","total_cost_usd":0.1234,"result":"done"}`)).toBe(0.1234);
  expect(costOf("pi said nothing about money")).toBe(0);
});

test("a fix lands on top of live edits made since the last commit, unless they touch the same lines", async () => {
  const OTHER = `import kleur from "kleur";\nexport const dim = (s: string) => kleur.dim(s);\n`;
  const fixer: Fixer = async () => ({ ok: true, tries: 1, out: "pass", edits: [
    { path: "src/paint.ts", before: COLOR, after: COLOR.replace(`import kleur from "kleur"`, `import * as kleur from "kleur/colors"`) },
    { path: "src/other.ts", before: OTHER, after: OTHER.replace(`import kleur from "kleur"`, `import * as kleur from "kleur/colors"`) },
  ] });
  const { call, send } = await app(kleurTester(), fixer);
  await send("ryan", "/api/repos/ryan/lab/files", { path: "src/other.ts", content: OTHER.replace(/\n$/, "") });
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=src/other.ts", { message: "other" });
  // Live edits on main, not committed: a line added at the end of paint.ts, and other.ts's import changed.
  const live = async (path: string, op: (lines: any[]) => any) => {
    const doc = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=${path}`)).json();
    expect((await send("ryan", `/api/repos/ryan/lab/do/ops?path=${path}`, { ops: [op(doc.lines)] })).status).toBe(200);
  };
  await live("src/paint.ts", (ls) => ({ kind: "insert", after: ls.at(-1).id, text: "export const info = (s: string) => s;" }));
  await live("src/other.ts", (ls) => ({ kind: "set", line: ls[0].id, base: ls[0].rev, text: `import kleur from "kleur"; // live` }));
  await send("ryan", "/api/repos/ryan/lab/deps", { max_level: "major", ignore: "ky", run_tests: true, fix_with: "claude" }, "PUT");
  await send("ryan", "/api/repos/ryan/lab/deps/run", {});
  const got = await settle(call);
  expect(got.report.note).toContain("merged into live edits, untested together: src/paint.ts");
  expect(got.report.note).toContain("touch the same lines: src/other.ts");
  const branch = got.report.branch;
  const paint = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=src/paint.ts&branch=${branch}`)).json();
  expect(paint.lines.map((l: any) => [l.text, l.by])).toEqual([
    [`import * as kleur from "kleur/colors";`, "agent-claude"],
    ["export const warn = (s: string) => kleur.red(s);", "ryan"],
    ["export const ok = (s: string) => kleur.green(s);", "ryan"],
    ["export const info = (s: string) => s;", "ryan"],
  ]);
  const other = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=src/other.ts&branch=${branch}`)).json();
  expect(other.lines[0].text).toBe(`import kleur from "kleur"; // live`);
});

test("a long run beats, so it's never taken for dead while it goes", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const tester: Tester = async () => { await held; return { ok: true, out: "pass" }; };
  const { call, send } = await app(tester);
  await send("ryan", "/api/repos/ryan/lab/deps", { run_tests: true }, "PUT");
  const db = call.env.DB;
  const since = async () => (await db.prepare("SELECT running_since FROM dep_watches WHERE owner = 'ryan' AND repo = 'lab'").first()).running_since as number | null;
  await db.prepare("UPDATE dep_watches SET running_since = 1 WHERE owner = 'ryan' AND repo = 'lab'").run();   // claimed long ago
  const done = runDoctor(call.env, (who, path, init) => call(who!, path, init), "ryan", "lab", { beatMs: 20 });
  await until(async () => ((await since()) ?? 0) > 1);
  expect(await since()).toBeGreaterThan(Date.now() - 5_000);
  release();
  await done;
  await Bun.sleep(60);
  expect(await since()).toBeNull();   // done, and no late beat brings it back
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
    const r = await localFixer(exec)({ remote: dir, files: { "package.json": pkg }, pm: "bun", update, out: "expected new:x", harness: "claude", tries: 3 });
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
    const gaveUp = await localFixer(async () => ({ code: 0, out: "" }))({ remote: dir, files: { "package.json": pkg }, pm: "bun", update, out: "", harness: "pi", tries: 2 });
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
  expect(first.report.branch).toBe(`deps-${new Date(NOW).toISOString().slice(0, 10)}`);
  await scheduledDoctor(call.env, self, NOW + 3_600_000);   // an hour later: not due
  expect((await (await call("ryan", "/api/repos/ryan/lab/deps")).json()).last_run).toBe(NOW);
  await scheduledDoctor(call.env, self, NOW + 25 * 3_600_000);
  expect((await (await call("ryan", "/api/repos/ryan/lab/deps")).json()).last_run).toBe(NOW + 25 * 3_600_000);
});

test("the doctor watches 10 of an owner's repos at most, every 6 hours at the most often (#797)", async () => {
  const { call, send } = await app();
  for (let i = 0; i < MAX_WATCHED; i++) await call.env.DB.prepare("INSERT INTO dep_watches (owner, repo, enabled) VALUES ('ryan', ?, 1)").bind(`other${i}`).run();
  const res = await send("ryan", "/api/repos/ryan/lab/deps", { on: true }, "PUT");
  expect(res.status).toBe(400);
  expect(((await res.json()) as any).error).toContain(`${MAX_WATCHED} of your repos at most`);
  expect((await send("ryan", "/api/repos/ryan/lab/deps", { on: false, every_hours: 168 }, "PUT")).status).toBe(200);
  await call.env.DB.prepare("UPDATE dep_watches SET enabled = 0 WHERE repo = 'other0'").run();
  expect((await send("ryan", "/api/repos/ryan/lab/deps", { on: true }, "PUT")).status).toBe(200);
  expect((await send("ryan", "/api/repos/ryan/lab/deps", { every_hours: 1 }, "PUT")).status).toBe(400);
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
  // Its registries are what a container's install may reach besides npm's (#681).
  expect(npmrcHosts([home, repo])).toEqual(["mirror.example", "npm.acme.dev"]);
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
  const { call, send } = await app(tester, undefined, `{\n  "name": "lab",\n  "workspaces": ["apps/*"],\n  "dependencies": { "mitt": "^3.0.0" }\n}`);
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
  expect(runs).toEqual([{ files: ["apps/web/package.json"], opts: { pm: "pnpm", lock: "pnpm-lock.yaml", test: false, hosts: [] } }]);
  const lock = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=pnpm-lock.yaml&branch=${report.branch}`)).json();
  expect(lock.lines.map((l: any) => l.text)).toEqual(["lockfileVersion: '9.0'", `apps/web/package.json: {"kleur":"^4.1.5","lab":"^1.0.0"}`, ""]);
  expect(lock.lines[0].by).toBe("ryan");   // an unchanged line keeps its author
  expect(lock.lines[1].by).toBe("agent-deps");
  const web = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=apps/web/package.json&branch=${report.branch}`)).json();
  expect(web.lines.find((l: any) => l.text.includes("kleur")).text).toBe(`    "kleur": "^4.1.5",`);
});

test("a scheduled run that runs out of time tests no further and branches only what passed", async () => {
  try {
    // Each fake test run takes 200ms, and kleur 4 breaks the build. The clock stands still
    // except for those runs, so how slow the machine is doesn't change what fits.
    setSystemTime(new Date());
    const tester: Tester = async (_remote, files) => {
      setSystemTime(new Date(Date.now() + 200));
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
  } finally {
    setSystemTime();
  }
});

describe("on Cloudflare, tests run in an AGENT_SANDBOX container", () => {
  /** The app with AGENT_SANDBOX bound to fake containers whose server answers /deps-test with `server`. */
  async function hosted(server: (path: string, body: any) => unknown) {
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
        return new AgentSandbox(gated(c), call.env);
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

  test("the fixer runs in a container too, with only its own harness's logins", async () => {
    const { call, send, seen } = await hosted((path, b) => path === "/deps-fix"
      ? { ok: true, tries: 1, out: "pass", edits: [{ path: "src/paint.ts", before: COLOR, after: COLOR.replace(`import kleur from "kleur"`, `import * as kleur from "kleur/colors"`) }] }
      : JSON.parse(b.files["package.json"]).dependencies.kleur === "^4.1.5" ? { ok: false, out: "kleur broke" } : { ok: true, out: "pass" });
    call.env.OPENAI_API_KEY = "sk-not-for-claude";
    await send("ryan", "/api/repos/ryan/lab/deps", { max_level: "major", ignore: "ky", run_tests: true, fix_with: "claude", fix_tries: 2 }, "PUT");
    const report = await (await send("ryan", "/api/repos/ryan/lab/deps/run", {})).json();
    expect(report.updates.find((u: any) => u.name === "kleur")).toMatchObject({ status: "fixed", fix: { by: "agent-claude", tries: 1, files: ["src/paint.ts"] } });
    const fix = seen.find((s) => s.path === "/deps-fix")!;
    expect(fix.env).toEqual({ ANTHROPIC_API_KEY: "sk-not-for-tests" });
    expect(fix.body).toMatchObject({ name: "kleur", tries: 2, out: "kleur broke", pm: "bun", cmd: { bin: "claude" } });
    // The prompt is a template: the container fills in each try.
    expect(fix.body.cmd.args[1]).toContain("Try {{try}} of 2");
    expect(fix.body.cmd.args[1]).toContain("{{out}}");
    const paint = await (await call("ryan", `/api/repos/ryan/lab/do/file?path=src/paint.ts&branch=${report.branch}`)).json();
    expect(paint.lines[0]).toMatchObject({ text: `import * as kleur from "kleur/colors";`, by: "agent-claude" });
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

  test("/deps-fix: the agent gets each try's prompt filled in, the tests decide, and its edits come back", async () => {
    const remote = await repo("grep -q 'v = 2' v.js");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${remote}/v.js`, "export const v = 0; // kleur\n");
    Bun.spawnSync(["git", "add", "v.js"], { cwd: remote });
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "use kleur"], { cwd: remote });
    // The fake agent writes the try it's on; the second is right. Its prompt names the history and the call sites.
    const prompt = "try {{try}}: {{out}} | {{history}} | {{sites}} | {{changelog}}";
    const cmd = { bin: "sh", args: ["-c", `printf '%s' "$1" > prompt.txt; echo "export const v = {{try}};" > v.js; git remote -v >> prompt.txt`, "sh", prompt] };
    const files = { "package.json": JSON.stringify({ name: "r", scripts: { test: "grep -q 'v = 2' v.js && cat prompt.txt" } }) };
    const r = await containerFix({ cmd, remote, files, pm: "bun", name: "kleur", out: "first failure", tries: 3 });
    expect(r).toMatchObject({ ok: true, tries: 2 });
    expect(r.out).toContain("try 2:");                 // the test printed the second try's prompt
    expect(r.out).toContain("use kleur");              // the repo's history of the package
    expect(r.out).toContain("v.js:1");                 // where it's used
    expect(r.out).not.toContain(remote);               // no remote left for the agent to see
    expect(r.edits.sort((a: any, b: any) => a.path.localeCompare(b.path))).toEqual([
      { path: "prompt.txt", before: null, after: expect.stringContaining("try 2") },
      { path: "v.js", before: "export const v = 0; // kleur\n", after: "export const v = 2;\n" },
    ]);
    const gaveUp = await containerFix({ cmd: { bin: "true", args: [] }, remote, files, pm: "bun", name: "kleur", tries: 2 });
    expect(gaveUp).toMatchObject({ ok: false, tries: 2, edits: [] });
    expect((await containerFix({ cmd, remote: "/no/such/repo", files, name: "kleur" }))).toMatchObject({ ok: false, tries: 0, edits: [] });
  }, 60_000);

  test("a bad remote or a path out of the clone fails cleanly", async () => {
    expect((await containerTest({ remote: "/no/such/repo", files: {} })).ok).toBe(false);
    const r = await containerTest({ remote: await repo("true"), files: { "../escape": "x" } });
    expect(r).toEqual({ ok: false, out: "bad path: ../escape" });
  });
});

test("over the doctor's limit, a run queues: the replay answers with the report, or running for the page to poll", async () => {
  const { call } = await app(undefined, undefined, PKG, { ADMINS: "boss" });   // else everyone is an admin, and never limited
  await call.env.DB.prepare("INSERT INTO limit_rules (name, max, window_s, enabled, on_fail) VALUES ('doctor', 1, 3600, 1, 'queue')").run();
  const run = () => call("ryan", "/api/repos/ryan/lab/deps/run", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.7" }, body: "{}" });
  expect((await run()).status).toBe(200);
  const over = await run();
  expect(over.status).toBe(202);
  const { queued } = (await over.json()) as any;
  expect(queued).toMatchObject({ rule: "doctor", state: "waiting", place: 1, label: "Dependency checks" });
  await call.env.DB.prepare("DELETE FROM limit_hits").run();
  const job = (await (await call("ryan", `/api/jobs/${queued.id}`)).json()) as any;
  // No tests to run, so it's quick: the report itself (a run that tests answers {running: true}, and the page polls).
  expect(job).toMatchObject({ state: "done", status: 200, result: { updates: expect.any(Array) } });
  expect((await settle(call)).running).toBe(false);
});
