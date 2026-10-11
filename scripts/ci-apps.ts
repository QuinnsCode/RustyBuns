// The apps CI knows about: how each one tests, and how it builds desktop binaries.
// apps.yml and desktop-drop.yml both read this, so adding an app is one entry here.
//
//   bun scripts/ci-apps.ts test <base-ref>     apps a PR touched (all of them if packages/ moved),
//                                              whether .claude/ moved (the guard hook tests), and the
//                                              touched apps' desktop smokes, one job per Mac and Linux target
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
};

export const APPS: Record<string, App> = {
  "agent-demo":        { test: "bun test test", drop: false },
  "agent-office":      { test: "bun test test", build: "bun scripts/rustybunsify.ts compile --all", smoke: "bun run desktop:build && bun run desktop:smoke" },
  "auto-rig":          { test: "bun test test", prep: "bun run build:native", perOs: true },
  "fm-daw":            { test: "bun test test", prep: "bun run build:native", perOs: true, check: true },
  "codesplitters":     { test: "bun test --parallel test" },
  "hippo-tycoon":      { test: "bun test --parallel test", prep: "bun run build:native", check: true },
  "meshy-studio":      { test: "bun test --parallel tests", check: true },
  "motion-midi":       { test: "bun test test", prep: "bun run build:native", perOs: true, check: true },
  "park-hide-seek":    { test: "bun test" },
  "splat-desktop":     { test: "bun test" },
  "splat-rooms":       { test: "bun test test" },
  "splat-spray":       { test: "bun test --parallel" },
  "tscircuit-desktop": { test: "bun test", prep: "bun run native", perOs: true },
};

const RUNNERS = [
  { runner: "ubuntu-latest", target: "linux-x64" },
  { runner: "ubuntu-24.04-arm", target: "linux-arm64" },
  { runner: "macos-latest", target: "darwin-arm64" },
  { runner: "macos-15-intel", target: "darwin-x64" },
  { runner: "windows-latest", target: "windows-x64" },
];
// The Cargo workspace rust-cache keys on.
const cargo = (app: string) => `apps/${app}/native`;
const CLI = "bun ../../packages/cli/src/index.ts build desktop";

function buildCmd(a: App, targets: string[]) {
  if (a.build) return a.build;
  return targets.map((t) => `${CLI}${a.check ? " --check" : ""} --target ${t}`).join(" && ");
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

if (cmd === "drop") {
  let names: string[];
  if (arg === "pr") {
    if (!base) throw new Error("drop pr needs a base ref");
    const pipeline = (await changedFiles(base)).some((f) => /^(scripts\/drop\.ts|\.github\/workflows\/desktop-drop\.yml)$/.test(f));
    const rows = pipeline ? "all" : await rowChanges(base);
    names = rows === "all" ? Object.keys(APPS) : [...rows];
  } else names = arg === "all" || !arg ? Object.keys(APPS) : arg.split(/[\s,]+/).filter(Boolean);
  names = names.filter((n) => APPS[n]?.drop !== false);
  const unknown = names.filter((n) => !APPS[n]);
  if (unknown.length) throw new Error(`unknown app(s): ${unknown.join(", ")}. Known: ${Object.keys(APPS).join(", ")}`);
  const include = names.flatMap((app) => {
    const a = APPS[app]!;
    const base = { app, prep: a.prep ?? "", cargo: cargo(app) };
    if (a.perOs) return RUNNERS.map((r) => ({ ...base, ...r, test: a.test ?? "", build: buildCmd(a, [r.target]) }));
    // Pure TS (or wasm, same on every OS): one Linux job builds every target.
    return [{ ...base, runner: "ubuntu-latest", target: "all", test: "", build: buildCmd(a, RUNNERS.map((r) => r.target)) }];
  });
  out("build", { include });
  out("apps", names);
  out("any", names.length > 0);
} else if (cmd === "test") {
  if (!arg) throw new Error("test needs a base ref");
  const changed = await changedFiles(arg);
  // A change to the shared code or the lockfile can break any app.
  const rows = changed.includes("scripts/ci-apps.ts") ? await rowChanges(arg) : new Set<string>();
  const shared = rows === "all" || changed.some((f) => /^(packages\/|bun\.lock$|package\.json$|\.github\/workflows\/apps\.yml$)/.test(f));
  const touched = new Set([...changed.map((f) => f.match(/^apps\/([^/]+)\//)?.[1]).filter(Boolean), ...(rows === "all" ? [] : rows)]);
  const names = Object.keys(APPS).filter((n) => APPS[n]!.test && (shared || touched.has(n)));
  out("apps", { include: names.map((app) => ({ app, test: APPS[app]!.test, prep: APPS[app]!.prep ?? "", cargo: cargo(app) })) });
  out("any", names.length > 0);
  const smokes = Object.keys(APPS).filter((n) => APPS[n]!.smoke && (shared || touched.has(n)))
    .flatMap((app) => RUNNERS.filter((r) => !r.target.startsWith("windows")).map((r) => ({ app, ...r, smoke: APPS[app]!.smoke })));
  out("smoke", { include: smokes });
  out("smokes", smokes.length > 0);
  out("packages", changed.some((f) => f.startsWith("packages/")));
  // bun test skips dot directories, so the agent guard hook's tests (.claude/hooks) get their own job.
  out("hooks", shared || changed.some((f) => f.startsWith(".claude/")));
} else {
  throw new Error("usage: bun scripts/ci-apps.ts test <base-ref> | drop <all|a,b,c>");
}
