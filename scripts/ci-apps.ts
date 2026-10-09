// The apps CI knows about: how each one tests, and how it builds desktop binaries.
// apps.yml and desktop-drop.yml both read this, so adding an app is one entry here.
//
//   bun scripts/ci-apps.ts test <base-ref>     apps a PR touched (all of them if packages/ moved)
//   bun scripts/ci-apps.ts drop <all|a,b,c>    the build matrix for desktop-drop.yml
//
// Prints `key=json` lines for $GITHUB_OUTPUT.
import { existsSync } from "node:fs";
type App = {
  test?: string;        // run in apps/<name>
  prep?: string;        // before test and build: cargo for native/ (cdylib) or rust/ (wasm)
  perOs?: boolean;      // Rust cdylibs don't cross-compile: one runner per OS
  build?: string;       // default: rustybuns build desktop --target <t>, for each target
  check?: boolean;      // typecheck before building (--check)
};

export const APPS: Record<string, App> = {
  "agent-office":      { test: "bun test test", build: "bun scripts/rustybunsify.ts compile --all" },
  "auto-rig":          { test: "bun test test", prep: "bun run build:native", perOs: true },
  "fm-daw":            { test: "bun test test", prep: "bun run build:native", perOs: true },
  "codesplitters":     { test: "bun test test" },
  "hippo-tycoon":      { test: "bun test test", prep: "bun run build:native", check: true },
  "motion-midi":       { test: "bun test test", prep: "bun run build:native", perOs: true },
  "park-hide-seek":    { test: "bun test" },
  "splat-desktop":     { test: "bun test" },
  "splat-rooms":       { test: "bun test test" },
  "splat-spray":       { test: "bun test" },
  "tscircuit-desktop": { test: "bun test", prep: "bun run native", perOs: true },
};

const RUNNERS = [
  { runner: "ubuntu-latest", target: "linux-x64" },
  { runner: "ubuntu-24.04-arm", target: "linux-arm64" },
  { runner: "macos-latest", target: "darwin-arm64" },
  { runner: "macos-15-intel", target: "darwin-x64" },
  { runner: "windows-latest", target: "windows-x64" },
];
// The Cargo workspace rust-cache keys on: native/ (cdylib) or rust/ (wasm).
const cargo = (app: string) => existsSync(`apps/${app}/native/Cargo.toml`) ? `apps/${app}/native` : `apps/${app}/rust`;
const CLI = "bun ../../packages/cli/src/index.ts build desktop";

function buildCmd(a: App, targets: string[]) {
  if (a.build) return a.build;
  return targets.map((t) => `${CLI}${a.check ? " --check" : ""} --target ${t}`).join(" && ");
}

const [cmd, arg = ""] = process.argv.slice(2);
const out = (k: string, v: unknown) => console.log(`${k}=${JSON.stringify(v)}`);

if (cmd === "drop") {
  const names = arg === "all" || !arg ? Object.keys(APPS) : arg.split(/[\s,]+/).filter(Boolean);
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
} else if (cmd === "test") {
  if (!arg) throw new Error("test needs a base ref");
  const changed = (await Bun.$`git diff --name-only ${arg}...HEAD`.text()).split("\n").filter(Boolean);
  // A change to the shared code or the lockfile can break any app.
  const shared = changed.some((f) => /^(packages\/|bun\.lock$|package\.json$|scripts\/ci-apps\.ts$|\.github\/workflows\/apps\.yml$)/.test(f));
  const touched = new Set(changed.map((f) => f.match(/^apps\/([^/]+)\//)?.[1]).filter(Boolean));
  const names = Object.keys(APPS).filter((n) => APPS[n]!.test && (shared || touched.has(n)));
  out("apps", { include: names.map((app) => ({ app, test: APPS[app]!.test, prep: APPS[app]!.prep ?? "", cargo: cargo(app) })) });
  out("any", names.length > 0);
  out("packages", changed.some((f) => f.startsWith("packages/")));
} else {
  throw new Error("usage: bun scripts/ci-apps.ts test <base-ref> | drop <all|a,b,c>");
}
