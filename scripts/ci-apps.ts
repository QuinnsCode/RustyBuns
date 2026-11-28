// The apps CI knows about: how each one tests, and how it builds desktop binaries.
// apps.yml and desktop-drop.yml both read this, so adding an app is one entry here.
//
//   bun scripts/ci-apps.ts test <base-ref>     apps a PR touched (all of them if the CI pipeline itself changed;
//                                              packages/ or the lockfile moving runs bun test packages, and
//                                              every app waits for the hourly ring), whether .claude/ moved
//                                              (the guard hook tests). With the root commit as base: every app.
//                                              Each app's tests run in up to LANES time-balanced jobs ("test mythic-masters 2/3")
//                                              A suite under a minute is one lane, and with no prep or boot it shares a
//                                              job with up to five others ("test borg+qcrm+...", scripts/ci-group.ts)
//                                              Every lane fails fast: the PR's test files first, --bail (#5920)
//   bun scripts/ci-apps.ts lanes <app>         that app's lanes as `bun run builder run` lines, to run one locally
//   --lanes n (or CI_LANES=n)                  lanes per app instead of 3, for every row without its own `shards`
//   bun scripts/ci-apps.ts smoke               every app's desktop smoke, one job per Mac and Linux target,
//                                              plus a job per bootOn target: desktop-hourly.yml, not PRs
//   bun scripts/ci-apps.ts drop <all|a,b,c>    the build matrix for desktop-drop.yml
//   bun scripts/ci-apps.ts drop pr <base-ref>  a PR's dry run: the apps whose rows below changed
//                                              (one app per build path if the pipeline itself changed: dropSample)
//
// Prints `key=json` lines for $GITHUB_OUTPUT.
type App = {
  test?: string;        // run in the app's folder: apps/<name>, or apps/frameworks/<name> (scripts/app-dirs.ts)
  shards?: number;      // lanes for this app instead of LANES (below): test's files spread over that many jobs by their time
  prep?: string;        // before test and build: cargo for native/ (cdylib or wasm)
  perOs?: boolean;      // Rust cdylibs don't cross-compile: one runner per OS
  build?: string;       // default: rustybuns build desktop --target <t>, for each target
  check?: boolean;      // typecheck before building (--check)
  drop?: false;         // tests only: no desktop binaries to build
  smoke?: string;       // build the host's binary and check it runs, on every Mac and Linux runner, when the app changes
  boot?: boolean;       // borg tier 1: build the dev host and boot it on the local twins (scripts/boot.ts)
  bootOn?: string[];    // build the release binary on these targets' own runners and boot it (boot.ts --bin), when the app changes
  with?: string[];      // other apps whose code this one runs: a change to them tests this one too
  slow?: { when: RegExp; run: string }; // a longer check its first lane runs after the tests, only when a PR changes a file `when` matches or this row
};

import { shard } from "../apps/codesplitter/scripts/ester.ts";
import { check, num, rec } from "../packages/util/src/guard.ts";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { appDir, appDirs, appOf, upFrom } from "./app-dirs.ts";
import { testFiles } from "./ci-test-count.ts";

export const APPS: Record<string, App> = {
  "agent-demo":        { test: "bun test test", drop: false },
  "alien-disc-golf":   { test: "bun test test", drop: false },
  "agent-office":      { test: "bun test test", with: ["excalibrawl"], build: "bun scripts/rustybunsify.ts compile --all", smoke: "bun run desktop:build && bun run desktop:smoke" },
  "auto-rig":          { test: "bun test test", prep: "bun run build:native", perOs: true, boot: true },
  "at-lens":           { test: "bun test test", drop: false },
  "artstewengine":     { test: "bun test test", drop: false },
  "eqosys":            { test: "bun test test", drop: false },
  "qollab":            { test: "bun test test", drop: false, with: ["eqosys"] },
  "geoboxq":            { test: "bun test test", drop: false },
  "geoboxq-shopify":   { test: "bun test test", drop: false },
  "sharesplat":        { test: "bun test test", drop: false },
  "copy-desk":         { test: "bun test test", drop: false },
  "agentworld":        { test: "bun test test", drop: false },
  "starter-game":      { test: "bun test test", drop: false },
  "fleet-commander":   { test: "bun test test", drop: false },
  "load-in":           { test: "bun test test", drop: false },
  "pwa-example":       { test: "bun test test", drop: false, boot: true },
  "qview3d":           { test: "bun test test", drop: false },
  "astro-example":     { test: "bun test test", boot: true },
  "borg":              { test: "bun test test", drop: false },
  "borg-postgres":     { test: "bun test test", drop: false },
  "excalibrawl":       { test: "bun test test", drop: false },
  "elysia-example":    { test: "bun test test", boot: true },
  "elysia-conduit":    { test: "bun test ./test", drop: false },   // ./: "test" alone is a name filter and would run their src/ unit tests, which need their .env
  "example":           { boot: true, drop: false },
  "fm-daw":            { test: "bun test test", shards: 10, prep: "bun run build:native", perOs: true, check: true, boot: true }, // 10: a lane of its browser tests runs ~2 min, one journey a file (#5919, #5922)
  "cron-swanson":      { test: "bun test test", drop: false },
  "hemyviz":           { test: "bun test test", drop: false },
  "test-swarm":        { test: "bun test test", drop: false },
  "codesplitter":     { test: "bun test --parallel test", boot: true, slow: { when: /^apps\/codesplitter\/(src\/client\.html$|src\/features\/|scripts\/tour-smoke\.ts$)/, run: "bun scripts/tour-smoke.ts" } },
  "delayed-reaction":  { test: "bun test test", drop: false },
  "git-recon":         { test: "bun test", drop: false },
  "hono-example":      { test: "bun test test", boot: true },
  "express-example":   { test: "bun test test", boot: true },
  "nextjs-example":    { test: "bun test test", boot: true },
  "nuxt-example":      { test: "bun test test", boot: true },
  "svelte-spa-example": { test: "bun test test", boot: true },
  "vue-spa-example":   { test: "bun test test", boot: true },
  "solid-spa-example": { test: "bun test test", boot: true },
  "hippo-tycoon":      { test: "bun test --parallel test", prep: "bun run build:native", check: true, boot: true },
  "meshy-studio":      { test: "bun test --parallel tests", check: true, boot: true },
  "motion-midi":       { test: "bun test test", prep: "bun run build:native", perOs: true, check: true, boot: true },
  "pixel-rag":         { test: "bun test test", prep: "bun run build:native", perOs: true },
  "park-hide-seek":    { test: "bun test", boot: true },
  "playground":        { test: "bun test test", drop: false },
  "qcrm":              { test: "bun test test", drop: false },
  "react-router-example": { test: "bun test test", boot: true },
  "qwik-example":      { test: "bun test test", boot: true },
  "skate-tech-park":   { test: "bun test --parallel --timeout 30000 test", drop: false },
  "solidstart-example": { test: "bun test test", boot: true },
  "splat-desktop":     { test: "bun test", boot: true },
  "splat-rooms":       { test: "bun test test", boot: true },
  "splat-spray":       { test: "bun test --parallel", boot: true, bootOn: ["windows-arm64"] },
  "sveltekit-example": { test: "bun test test", boot: true },
  "two-fronts":        { test: "bun test test", shards: 4, drop: false },
  "terraviz-demo":     { test: "bun test test", drop: false },
  "tanstack-start-example": { test: "bun test test", boot: true },
  "what-would-fantano-say": { test: "bun test test", drop: false },
  "mythic-masters":    { test: "bun test test", drop: false },
};

const RUNNERS = [
  { runner: "ubuntu-latest", target: "linux-x64" },
  { runner: "ubuntu-24.04-arm", target: "linux-arm64" },
  { runner: "macos-latest", target: "darwin-arm64" },
  // GitHub's Intel Mac runs fm-daw's suite about twice as slow as the arm one (#5498): a test near bun's 5 s
  // default there gets a longer one. A file's own setDefaultTimeout still wins, so heavy files set theirs.
  { runner: "macos-15-intel", target: "darwin-x64", timeout: 30_000 },
  { runner: "windows-latest", target: "windows-x64" },
  { runner: "windows-11-arm", target: "windows-arm64" },
];
// The Cargo workspace rust-cache keys on.
const cargo = (app: string) => `${appDir(app)}/native`;
// Commands run in the app's folder, one or two levels under apps/; `up` climbs back to the repo root.
const up = (app: string) => upFrom(appDir(app));
const cli = (app: string) => `bun ${up(app)}packages/cli/src/index.ts build desktop`;
const where = (app: string) => ({ app, dir: appDir(app), up: up(app) });

// Each binary is named for the app's folder, which is what the upload looks for, even when the
// config's name differs (codesplitter keeps the name codesplitters for its state).
const binFile = (app: string, t: string) => `dist/${app}-${t}${t.startsWith("windows") ? ".exe" : ""}`;
function buildCmd(app: string, a: App, targets: string[]) {
  if (a.build) return a.build;
  return targets.map((t) => `${cli(app)}${a.check ? " --check" : ""} --target ${t} --outfile ${binFile(app, t)}`).join(" && ");
}

// How many lanes each app's tests split into unless its row says `shards`: one knob for the whole matrix, so the same
// buckets can go to more boxes later. `--lanes n` on the command line, else CI_LANES, else 3.
const laneArg = import.meta.main ? process.argv.indexOf("--lanes") : -1;
export const LANES = Math.max(1, Number(laneArg > 0 ? process.argv.splice(laneArg, 2)[1] : process.env.CI_LANES || 3) || 3);

// A lane fails fast (#5920): bun runs the files in the order they're named and --bail stops it at the first failing
// test, so a PR's own breakage shows in its first minute and the rest of the lane's runner time is freed.
const BAIL = "--bail";
/** `test` with --bail after its `test` word, unless it already has it. */
export const bail = (test: string) => test.split(/\s+/).includes(BAIL) ? test : test.replace(/\btest\b/, `test ${BAIL}`);

/** `test` as one command per lane, its files spread by Ester's shard() on their times: the same files and times always
 *  give the same lanes, and never an empty one (an app with two files gets two lanes). Flags stay, paths and filters go.
 *  In each lane the files `first` picks (the PR's own test files) run before the rest, and the lane stops at its first failure. */
export function laneCommands(test: string, files: { name: string; ms: number }[], n: number, first: (name: string) => boolean = () => false): string[] {
  const words = bail(test).split(/\s+/), at = words.indexOf("test");
  const flags = words.slice(at + 1).filter((w, i, all) => w.startsWith("-") || (/^\d+$/.test(w) && !!all[i - 1]?.startsWith("-")));
  const prefix = [...words.slice(0, at + 1), ...flags].join(" ");
  const rank = (name: string) => first(name) ? 0 : 1;
  return shard(files, n).filter((s) => s.length).map((s) =>
    `${prefix} ${s.map((t) => t.name).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((f) => `./${f}`).join(" ")}`);
}

// An app's test files and their weights. A file's weight is its recorded ms (<app dir>/test-times.json, written by
// scripts/test-times.ts from CI's own logs), or its size when it has none, so a new file still lands somewhere sensible.
async function weighed(app: string, test: string): Promise<{ name: string; ms: number }[]> {
  const dir = appDir(app);
  const times = check(rec(num(0, Infinity)), await Bun.file(`${dir}/test-times.json`).json().catch(() => null)) ?? {};
  return testFiles(test, dir).map((name) => ({ name, ms: times[name] ?? Math.round(Bun.file(`${dir}/${name}`).size / 20) }));
}

// Every job pays ~28 s of checkout, setup and install before its first test, and most suites take less than a minute
// (notes/CI_STALL_2026-11-21.md, #5564). A suite under SMALL_MS isn't split into lanes (each lane would pay that again,
// and a native build too), and one with nothing to build or boot shares a job with up to GROUP - 1 others. Six was the
// reassessment's pick: at most ~6 min a job, one install.
export const SMALL_MS = 60_000, GROUP = 6;
export const oneLane = (a: App, files: { ms: number }[]) => !!a.test && !a.shards && files.reduce((t, f) => t + f.ms, 0) < SMALL_MS;
export const isSmall = (a: App, files: { ms: number }[]) => oneLane(a, files) && !a.prep && !a.boot;
/** The small apps, GROUP to a job, in APPS order. */
export const groups = (apps: string[], size = GROUP) =>
  Array.from({ length: Math.ceil(apps.length / size) }, (_, i) => apps.slice(i * size, (i + 1) * size));

// An app's lanes (one when its suite is small), each failing fast with the `changed` test files (repo-relative) first.
// A one-lane suite keeps its own command unless the PR changed one of its test files, which then has to be named first.
async function shardedTests(app: string, test: string, n: number, changed = new Set<string>()): Promise<string[]> {
  const files = await weighed(app, test), mine = (name: string) => changed.has(`${appDir(app)}/${name}`);
  if (!oneLane(APPS[app] ?? { test }, files)) return laneCommands(test, files, n, mine);
  return files.some((f) => mine(f.name)) ? laneCommands(test, files, 1, mine) : [bail(test)];
}
const filters = (apps: string[]) => apps.map((n) => `--filter ./${appDir(n)}`).join(" ");

const [cmd, arg = "", base = ""] = import.meta.main ? process.argv.slice(2) : [];

// Code every app leans on: shared packages, the lockfile, this workflow. Prose isn't, so a README or skill under
// packages/ runs only the packages' tests (`packages` below), not the hooks and scripts tests a code change brings.
// The other apps an app's code reaches by a relative path: an import ("../../geoboxq/src/worker.ts") or a folder it
// reads (join(import.meta.dir, "../../hello-world")). Every quoted "../" string in its code files that lands in another
// app's folder counts, so a lane's sparse checkout has them without anyone listing them.
export function reachedApps(app: string, root = join(import.meta.dir, "..")): string[] {
  const dirs = [...appDirs(root)], own = appDir(app, root), found = new Set<string>();
  for (const file of new Bun.Glob("**/*.{ts,tsx,js,jsx,mjs,cjs,css,html}").scanSync({ cwd: join(root, own) })) {
    if (file.includes("node_modules/")) continue;
    const text = readFileSync(join(root, own, file), "utf8");
    for (const [, rel] of text.matchAll(/["'`]((?:\.\.\/)+[^"'`\s?]*)/g)) {
      const to = relative(root, resolve(root, own, dirname(file), rel!));
      const hit = dirs.find(([, d]) => d !== own && (to === d || to.startsWith(d + "/")));
      if (hit) found.add(hit[0]);
    }
  }
  return [...found].sort();
}

// The app folders a test lane checks out (apps.yml's sparse checkout, #5509): its own, its `with` apps and the ones
// its code reaches (reachedApps).
export const sparseDirs = (app: string, root?: string) =>
  [...new Set([app, ...(APPS[app]!.with ?? []), ...reachedApps(app, root)])].map((n) => `/${appDir(n, root)}/`).join("\n");
// A doc in an app that the app's code names in a quoted path ("../docs/RULES.md", join(APP, "REFERENCE.md")) may be
// read by a test, so changing it runs the app's suite. Any other .md there is prose: a PR that only edits those runs
// none of it (#5952). A doc read by a name the code builds at run time slips by here; the hourly ring still runs it.
const codeText = new Map<string, string>();
export function docRead(file: string, root = join(import.meta.dir, "..")): boolean {
  const app = appOf(file);
  if (!app || !/\.md$/i.test(file)) return true;
  const key = `${root}\0${app}`, dir = appDir(app, root);
  if (!codeText.has(key)) {
    const parts: string[] = [];
    for (const f of new Bun.Glob("**/*.{ts,tsx,js,jsx,mjs,cjs}").scanSync({ cwd: join(root, dir) }))
      if (!f.includes("node_modules/")) parts.push(readFileSync(join(root, dir, f), "utf8"));
    codeText.set(key, parts.join("\n"));
  }
  const name = file.split("/").pop()!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["'\`/]${name}["'\`]`).test(codeText.get(key)!);
}
export const sharedCode = (f: string) => /^(packages\/|bun\.lock$|\.github\/workflows\/apps\.yml$)/.test(f) && !/\.md$/i.test(f);
// The apps whose tests a changed file can break: the app whose folder it is in, and playground for a package's
// package.json. playground's shelf.json is built from each package.json (its description and shelf field) and its apps
// test checks the two match, so a stale shelf used to merge green and turn the hourly main run red (#5899).
export const appsFor = (f: string) => [appOf(f), /^packages\/[^/]+\/package\.json$/.test(f) ? "playground" : undefined].filter((a): a is string => !!a);
// A PR that changes the drop pipeline (drop.ts, scripts/mac/, the workflow, this file's machinery) dry-runs one app per
// build path, not every app: every app was up to about 70 jobs a push, 26 of them macOS drop jobs, and in the week to
// 2026-11-21 that was two thirds of the runner time of apps.yml and typecheck.yml put together (notes/CI_STALL_2026-11-21.md, #4136).
// The paths: the default cross-compile from Linux, a row with its own build command, and a Rust cdylib on one runner
// per OS. The cost: an app-specific build break from a pipeline change shows at its next real drop, or in a dry run of
// "all" from the Actions tab, which a pipeline PR should still get before it merges.
export function dropSample(apps: Record<string, App>): string[] {
  const dropping = Object.keys(apps).filter((n) => apps[n]!.drop !== false);
  const paths = [(a: App) => !a.perOs && !a.build, (a: App) => !a.perOs && !!a.build, (a: App) => !!a.perOs];
  return paths.map((is) => dropping.find((n) => is(apps[n]!))).filter((n): n is string => !!n);
}

const out = (k: string, v: unknown) => console.log(`${k}=${JSON.stringify(v)}`);
/** The app's slow check, if this PR changed what it covers (a file `slow.when` matches, or the app's own row); else "". */
export const slowRun = (a: App, changed: string[], rowChanged = false): string =>
  a.slow && (rowChanged || changed.some((f) => a.slow!.when.test(f))) ? a.slow.run : "";

const changedFiles = async (base: string) => (await Bun.$`git diff --name-only ${base}...HEAD`.text()).split("\n").filter(Boolean);

// Editing one app's row in APPS should only rerun that app. Returns the apps whose rows changed,
// or "all" when any other line of this file did.
async function rowChanges(base: string): Promise<Set<string> | "all"> {
  const diff = await Bun.$`git diff -U0 ${base}...HEAD -- scripts/ci-apps.ts`.text();
  const apps = new Set<string>();
  for (const line of diff.split("\n")) {
    if (!/^[+-](?![+-])/.test(line) || /^[+-]\s*$/.test(line)) continue;
    const row = line.match(/^[+-]\s*"([\w-]+)":\s*\{.*\},?\s*$/);
    if (!row) return "all";
    if (APPS[row[1]!]) apps.add(row[1]!);
  }
  return apps;
}

// Root package.json edits to its scripts or version can't break an app; anything else (dependencies,
// overrides, patches, workspaces) can.
async function rootDepsChanged(base: string): Promise<boolean> {
  const strip = (txt: string) => { try { const { scripts, version, ...rest } = JSON.parse(txt); return JSON.stringify(rest); } catch { return txt; } };
  const mb = (await Bun.$`git merge-base ${base} HEAD`.quiet().nothrow().text()).trim() || base;
  const before = await Bun.$`git show ${mb}:package.json`.quiet().nothrow().text();
  return strip(before) !== strip(await Bun.file("package.json").text());
}

if (cmd === "drop") {
  let names: string[];
  if (arg === "pr") {
    if (!base) throw new Error("drop pr needs a base ref");
    const pipeline = (await changedFiles(base)).some((f) => /^(scripts\/drop\.ts$|scripts\/mac\/|\.github\/workflows\/desktop-drop\.yml$)/.test(f));
    const rows = pipeline ? "all" : await rowChanges(base);
    names = rows === "all" ? dropSample(APPS) : [...rows];
  } else names = arg === "all" || !arg ? Object.keys(APPS) : arg.split(/[\s,]+/).filter(Boolean);
  names = names.filter((n) => APPS[n]?.drop !== false);
  const unknown = names.filter((n) => !APPS[n]);
  if (unknown.length) throw new Error(`unknown app(s): ${unknown.join(", ")}. Known: ${Object.keys(APPS).join(", ")}`);
  const include = names.flatMap((app) => {
    const a = APPS[app]!;
    const base = { ...where(app), prep: a.prep ?? "", cargo: cargo(app) };
    if (a.perOs) return RUNNERS.map(({ timeout, ...r }) => ({ ...base, ...r, test: a.test && timeout ? `${a.test} --timeout ${timeout}` : a.test ?? "", build: buildCmd(app, a, [r.target]) }));
    // Pure TS (or wasm, same on every OS): one Linux job builds every target.
    return [{ ...base, runner: "ubuntu-latest", target: "all", test: "", build: buildCmd(app, a, RUNNERS.map((r) => r.target)) }];
  });
  out("build", { include });
  out("apps", names);
  out("any", names.length > 0);
} else if (cmd === "test") {
  if (!arg) throw new Error("test needs a base ref");
  const changed = await changedFiles(arg);
  // A change to the pipeline (this file's machinery, apps.yml) runs every app here. Shared code, the lockfile or the root
  // package.json's dependencies can break any app too, but that sweep is the hourly ring's (desktop-hourly.yml, release
  // rings step 5, #4492): the PR runs the packages' own tests and the apps it touched.
  const rows = changed.includes("scripts/ci-apps.ts") ? await rowChanges(arg) : new Set<string>();
  const shared = rows === "all" || changed.includes(".github/workflows/apps.yml");
  const deps = changed.some(sharedCode) || (changed.includes("package.json") && await rootDepsChanged(arg));
  const touched = new Set([...changed.filter((f) => docRead(f)).flatMap(appsFor), ...(rows === "all" ? [] : rows)]);
  const names = Object.keys(APPS).filter((n) => (APPS[n]!.test || APPS[n]!.boot) && (shared || touched.has(n) || !!APPS[n]!.with?.some((w) => touched.has(w))));
  const files = new Map(await Promise.all(names.map(async (n) => [n, APPS[n]!.test ? await weighed(n, APPS[n]!.test!) : []] as const)));
  const small = names.filter((n) => isSmall(APPS[n]!, files.get(n)!));
  const own = new Set(changed);
  // A group job is one lane too: the apps the PR touched run first, each with its changed test files first (#5920).
  const grouped = await Promise.all(groups(small).filter((g) => g.length > 1).map(async (g) => {
    const order = [...g].sort((a, b) => Number(!touched.has(a)) - Number(!touched.has(b)));
    const tests = await Promise.all(order.map(async (n) => `${appDir(n)} '${(await shardedTests(n, APPS[n]!.test!, 1, own))[0]}'`));
    return {
      app: g.join("+"), dir: ".", up: "", boot: false, slow: "", prep: "", cargo: "", shard: "", filters: filters(g),
      sparse: [...new Set(g.flatMap((n) => sparseDirs(n).split("\n")))].join("\n"), test: `bun scripts/ci-group.ts ${tests.join(" ")}`,
    };
  }));
  const alone = names.filter((n) => !grouped.some((g) => g.app.split("+").includes(n)));
  const include = (await Promise.all(alone.map(async (app) => {
    const a = APPS[app]!, row = { ...where(app), boot: !!a.boot, slow: slowRun(a, changed, rows !== "all" && rows.has(app)), prep: a.prep ?? "", cargo: cargo(app), sparse: sparseDirs(app), filters: filters([app]) };
    const lanes = a.test ? await shardedTests(app, a.test, a.shards ?? LANES, own) : [];
    if (lanes.length < 2) return [{ ...row, test: lanes[0] ?? a.test ?? "", shard: "" }];
    // Boot and the slow check run once, with the first lane.
    return lanes.map((test, i, all) => ({ ...row, boot: row.boot && i === 0, slow: i === 0 ? row.slow : "", test, shard: `${i + 1}/${all.length}` }));
  }))).flat().concat(grouped);
  out("apps", { include });
  out("any", names.length > 0);
  out("packages", deps || changed.some((f) => f.startsWith("packages/")));
  // The shared skin test (packages/util/test/skin.test.ts) reads three games' skins and stylesheets (its skin-server.ts
  // GAMES), so a game PR that changes one runs it too: #4210 turned it red on main from an app-only PR.
  out("skins", changed.some((f) => /^apps\/(two-fronts|mythic-masters|skate-tech-park)\/src\/(eqosys|account)\.ts$|^apps\/(two-fronts|skate-tech-park)\/src\/styles\.css$|^apps\/mythic-masters\/src\/tome\.css$/.test(f)));
  // bun test skips dot directories, so the agent guard hook's tests (.claude/hooks) get their own job.
  out("hooks", shared || deps || changed.some((f) => f.startsWith(".claude/")));
  // The root scripts' own tests (preflight, pr, docs, ...): no app row covers them.
  out("scripts", shared || deps || changed.some((f) => f.startsWith("scripts/")));
  // The test files this PR adds or changes, space-separated: ci-test-count.ts fails a test there over 80% of its limit.
  console.log(`tests=${changed.filter((f) => /[._](test|spec)\.[cm]?[jt]sx?$/.test(f)).join(" ")}`);
} else if (cmd === "lanes") {
  // The lanes apps.yml gives one app, one line each, to run a single lane here or on the builder.
  const a = APPS[arg];
  if (!a?.test) throw new Error(`no tests for app "${arg}". Known: ${Object.keys(APPS).filter((n) => APPS[n]!.test).join(", ")}`);
  const lanes = await shardedTests(arg, a.test, a.shards ?? LANES);
  for (const [i, t] of lanes.entries()) console.log(`${i + 1}/${Math.max(1, lanes.length)}  bun run builder run ${appDir(arg)} ${t}`);
} else if (cmd === "smoke") {
  const smokes = Object.keys(APPS).filter((n) => APPS[n]!.smoke)
    .flatMap((app) => RUNNERS.filter((r) => !r.target.startsWith("windows")).map((r) => ({ ...where(app), ...r, smoke: APPS[app]!.smoke })))
    .concat(Object.keys(APPS).filter((n) => APPS[n]!.bootOn).flatMap((app) =>
      RUNNERS.filter((r) => APPS[app]!.bootOn!.includes(r.target)).map((r) => ({ ...where(app), ...r, smoke: `${buildCmd(app, APPS[app]!, [r.target])} && bun ${up(app)}scripts/boot.ts --bin ${binFile(app, r.target)}` }))));
  out("smoke", { include: smokes });
  out("smokes", smokes.length > 0);
} else if (import.meta.main) {
  throw new Error("usage: bun scripts/ci-apps.ts test <base-ref> | lanes <app> | smoke | drop <all|a,b,c>");
}
