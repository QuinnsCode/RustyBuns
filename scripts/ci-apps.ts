// The apps CI knows about: how each one tests, and how it builds desktop binaries.
// apps.yml and desktop-drop.yml both read this, so adding an app is one entry here.
//
//   bun scripts/ci-apps.ts test <base-ref>     apps a PR touched (all of them if packages/ moved),
//                                              whether .claude/ moved (the guard hook tests)
//   bun scripts/ci-apps.ts smoke               every app's desktop smoke, one job per Mac and Linux target,
//                                              plus a job per bootOn target: desktop-hourly.yml, not PRs
//   bun scripts/ci-apps.ts drop <all|a,b,c>    the build matrix for desktop-drop.yml
//   bun scripts/ci-apps.ts drop pr <base-ref>  a PR's dry run: the apps whose rows below changed
//                                              (all of them if the pipeline itself changed)
//
// Prints `key=json` lines for $GITHUB_OUTPUT.
type App = {
  test?: string;        // run in apps/<name>
  prep?: string;        // before test and build: cargo for native/ (cdylib or wasm)
  perOs?: boolean;      // Rust cdylibs don't cross-compile: one runner per OS
  build?: string;       // default: rustybuns build desktop --target <t>, for each target
  check?: boolean;      // typecheck before building (--check)
  drop?: false;         // tests only: no desktop binaries to build
  smoke?: string;       // build the host's binary and check it runs, on every Mac and Linux runner, when the app changes
  boot?: boolean;       // borg tier 1: build the dev host and boot it on the local twins (scripts/boot.ts)
  bootOn?: string[];    // build the release binary on these targets' own runners and boot it (boot.ts --bin), when the app changes
};

export const APPS: Record<string, App> = {
  "agent-demo":        { test: "bun test test", drop: false },
  "agent-office":      { test: "bun test test", build: "bun scripts/rustybunsify.ts compile --all", smoke: "bun run desktop:build && bun run desktop:smoke" },
  "auto-rig":          { test: "bun test test", prep: "bun run build:native", perOs: true, boot: true },
  "borg":              { test: "bun test test", drop: false },
  "borg-postgres":     { test: "bun test test", drop: false },
  "excalibrawl":       { test: "bun test test", drop: false },
  "example":           { boot: true, drop: false },
  "fm-daw":            { test: "bun test test", prep: "bun run build:native", perOs: true, check: true, boot: true },
  "codesplitter":     { test: "bun test --parallel test", boot: true },
  "git-recon":         { test: "bun test", drop: false },
  "hippo-tycoon":      { test: "bun test --parallel test", prep: "bun run build:native", check: true, boot: true },
  "meshy-studio":      { test: "bun test --parallel tests", check: true, boot: true },
  "motion-midi":       { test: "bun test test", prep: "bun run build:native", perOs: true, check: true, boot: true },
  "park-hide-seek":    { test: "bun test", boot: true },
  "splat-desktop":     { test: "bun test", boot: true },
  "splat-rooms":       { test: "bun test test", boot: true },
  "splat-spray":       { test: "bun test --parallel", boot: true, bootOn: ["windows-arm64"] },
  "two-fronts":        { test: "bun test test", drop: false },
  "tscircuit-desktop": { test: "bun test", prep: "bun run native", perOs: true, boot: true },
  "what-would-fantano-say": { test: "bun test test", drop: false },
};

const RUNNERS = [
  { runner: "ubuntu-latest", target: "linux-x64" },
  { runner: "ubuntu-24.04-arm", target: "linux-arm64" },
  { runner: "macos-latest", target: "darwin-arm64" },
  { runner: "macos-15-intel", target: "darwin-x64" },
  { runner: "windows-latest", target: "windows-x64" },
  { runner: "windows-11-arm", target: "windows-arm64" },
];
// The Cargo workspace rust-cache keys on.
const cargo = (app: string) => `apps/${app}/native`;
const CLI = "bun ../../packages/cli/src/index.ts build desktop";

// Each binary is named for the app's folder, which is what the upload looks for, even when the
// config's name differs (codesplitter keeps the name codesplitters for its state).
const binFile = (app: string, t: string) => `dist/${app}-${t}${t.startsWith("windows") ? ".exe" : ""}`;
function buildCmd(app: string, a: App, targets: string[]) {
  if (a.build) return a.build;
  return targets.map((t) => `${CLI}${a.check ? " --check" : ""} --target ${t} --outfile ${binFile(app, t)}`).join(" && ");
}

const [cmd, arg = "", base = ""] = process.argv.slice(2);
const out = (k: string, v: unknown) => console.log(`${k}=${JSON.stringify(v)}`);
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
    names = rows === "all" ? Object.keys(APPS) : [...rows];
  } else names = arg === "all" || !arg ? Object.keys(APPS) : arg.split(/[\s,]+/).filter(Boolean);
  names = names.filter((n) => APPS[n]?.drop !== false);
  const unknown = names.filter((n) => !APPS[n]);
  if (unknown.length) throw new Error(`unknown app(s): ${unknown.join(", ")}. Known: ${Object.keys(APPS).join(", ")}`);
  const include = names.flatMap((app) => {
    const a = APPS[app]!;
    const base = { app, prep: a.prep ?? "", cargo: cargo(app) };
    if (a.perOs) return RUNNERS.map((r) => ({ ...base, ...r, test: a.test ?? "", build: buildCmd(app, a, [r.target]) }));
    // Pure TS (or wasm, same on every OS): one Linux job builds every target.
    return [{ ...base, runner: "ubuntu-latest", target: "all", test: "", build: buildCmd(app, a, RUNNERS.map((r) => r.target)) }];
  });
  out("build", { include });
  out("apps", names);
  out("any", names.length > 0);
} else if (cmd === "test") {
  if (!arg) throw new Error("test needs a base ref");
  const changed = await changedFiles(arg);
  // A change to the shared code, the lockfile or the root package.json's dependencies can break any app.
  const rows = changed.includes("scripts/ci-apps.ts") ? await rowChanges(arg) : new Set<string>();
  const shared = rows === "all" || changed.some((f) => /^(packages\/|bun\.lock$|\.github\/workflows\/apps\.yml$)/.test(f))
    || (changed.includes("package.json") && await rootDepsChanged(arg));
  const touched = new Set([...changed.map((f) => f.match(/^apps\/([^/]+)\//)?.[1]).filter(Boolean), ...(rows === "all" ? [] : rows)]);
  const names = Object.keys(APPS).filter((n) => (APPS[n]!.test || APPS[n]!.boot) && (shared || touched.has(n)));
  out("apps", { include: names.map((app) => ({ app, test: APPS[app]!.test ?? "", boot: !!APPS[app]!.boot, prep: APPS[app]!.prep ?? "", cargo: cargo(app) })) });
  out("any", names.length > 0);
  out("packages", changed.some((f) => f.startsWith("packages/")));
  // bun test skips dot directories, so the agent guard hook's tests (.claude/hooks) get their own job.
  out("hooks", shared || changed.some((f) => f.startsWith(".claude/")));
} else if (cmd === "smoke") {
  const smokes = Object.keys(APPS).filter((n) => APPS[n]!.smoke)
    .flatMap((app) => RUNNERS.filter((r) => !r.target.startsWith("windows")).map((r) => ({ app, ...r, smoke: APPS[app]!.smoke })))
    .concat(Object.keys(APPS).filter((n) => APPS[n]!.bootOn).flatMap((app) =>
      RUNNERS.filter((r) => APPS[app]!.bootOn!.includes(r.target)).map((r) => ({ app, ...r, smoke: `${buildCmd(app, APPS[app]!, [r.target])} && bun ../../scripts/boot.ts --bin ${binFile(app, r.target)}` }))));
  out("smoke", { include: smokes });
  out("smokes", smokes.length > 0);
} else {
  throw new Error("usage: bun scripts/ci-apps.ts test <base-ref> | smoke | drop <all|a,b,c>");
}
