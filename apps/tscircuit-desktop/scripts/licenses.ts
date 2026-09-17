// Third-party notices for everything the desktop binary ships.
//
// Used two ways:
//   - vite.config.ts calls collectNotices() with the exact modules in the UI
//     bundle, so every build writes an accurate THIRD_PARTY_LICENSES.txt into
//     dist/ui (embedded in the binary, served at /THIRD_PARTY_LICENSES.txt) and
//     next to the binaries in dist/.
//   - `bun scripts/licenses.ts` for a quick review without building. It can't
//     see the bundle, so it lists every package reachable from "dependencies"
//     (over-counts build tools); use the build for the real file.
//
// Coverage:
//   UI:     npm packages whose code is in the Vite bundle
//   Host:   packages desktop/host.ts imports (HOST_ROOTS) and their dependencies
//   Native: Rust crates linked into the engine (compile-time-only crates skipped)
//   Bun:    the runtime every compiled binary embeds
//
// Packages with no declared license can be vouched for in licenses/overrides.json,
// each with a link to the LICENSE it was checked against.

// Plain Node APIs only: vite.config.ts loads this under Node.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd: string, args: string[]): string | null {
  try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }); }
  catch { return null; }
}
/** The Bun that will compile the binary is the Bun it embeds. */
const bunVersion = () => (globalThis as any).Bun?.version ?? run("bun", ["--version"])?.trim() ?? "(unknown version)";
/** Packages the Bun host imports at runtime (see desktop/host.ts). */
export const HOST_ROOTS = ["circuit-json-to-gerber", "circuit-json-to-bom-csv", "circuit-json-to-pnp-csv"];
/**
 * Packages that ship a prebuilt bundle with their own dependencies baked in.
 * The bundle graph sees one module, so their build-time dependency lists are
 * read instead (minus tooling that can't end up in the output).
 */
export const PREBUNDLED: Record<string, RegExp> = {
  "@tscircuit/eval": /^(@types\/|@biomejs|typescript$|tsup$|bun-types$|@playwright|playwright|prettier|esbuild|vitest|@vitejs|vite$|concurrently|tsx$|chokidar-cli$|howfat$|live-server$|pkg-pr-new$|ts-expect$)/,
};
const PERMISSIVE = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|0BSD|Apache-2\.0|Unlicense|CC0-1\.0|BlueOak-1\.0\.0|Python-2\.0|Unicode-3\.0|Zlib|WTFPL|CC-BY-4\.0)$/i;

export interface Entry { name: string; version: string; license: string; source: string; texts: string[]; vouched?: string; where: Set<string> }
export interface Notices { text: string; entries: Entry[]; flagged: Entry[]; summary: string }

const overrides: Record<string, { license: string; evidence: string; text: string }> =
  (() => { try { return JSON.parse(readFileSync(join(APP, "licenses", "overrides.json"), "utf8")).packages; } catch { return {}; } })();

const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

function findPackage(name: string, from: string): string | null {
  let dir = from;
  while (true) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return realpathSync(dirname(candidate));
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** The package root that owns a bundled module id (".../node_modules/@scope/pkg/dist/x.js"). */
export function packageDirOf(moduleId: string): string | null {
  const id = moduleId.replace(/^\0/, "").split("?")[0]!;
  const i = id.lastIndexOf(`${sep}node_modules${sep}`);
  if (i < 0) return null;
  const rest = id.slice(i + 14).split(sep);
  const n = rest[0]!.startsWith("@") ? 2 : 1;
  return join(id.slice(0, i + 14), ...rest.slice(0, n));
}

function licenseOf(pkg: any): string {
  const l = pkg.license ?? pkg.licenses;
  if (typeof l === "string") return l;
  if (Array.isArray(l)) return l.map((x) => (typeof x === "string" ? x : x?.type)).filter(Boolean).join(" OR ");
  if (l && typeof l === "object" && l.type) return l.type;
  return "UNKNOWN";
}

function licenseTexts(dir: string): string[] {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => /^(licen[cs]e|copying|notice)(\b|[.\-_])/i.test(n)).sort()
    .map((n) => { try { return readFileSync(join(dir, n), "utf8").trim(); } catch { return ""; } })
    .filter(Boolean);
}

/** Any installed copy of `name` anywhere in the workspace's Bun store. */
function findInStore(name: string): string | null {
  for (let dir = APP; ; dir = dirname(dir)) {
    const store = join(dir, "node_modules", ".bun");
    if (existsSync(store)) {
      const prefix = name.replace("/", "+") + "@";
      for (const entry of readdirSync(store)) {
        if (!entry.startsWith(prefix)) continue;
        const p = join(store, entry, "node_modules", name);
        if (existsSync(join(p, "package.json"))) return realpathSync(p);
      }
    }
    if (dirname(dir) === dir) return null;
  }
}

class Registry {
  byKey = new Map<string, Entry>();
  /** A dependency baked into another package's bundle, which may not be installed. */
  addBaked(name: string, spec: string, where: string) {
    const dir = findPackage(name, APP) ?? findInStore(name);
    if (dir) { this.closure([[name, dirname(dir)]], where, dir); return; }
    const key = `${name}@${spec}`;
    if (this.byKey.has(key)) { this.byKey.get(key)!.where.add(where); return; }
    const o = overrides[name];
    this.byKey.set(key, {
      name, version: `${spec} (not installed; inferred from the bundle's build manifest)`, where: new Set([where]),
      license: o?.license ?? "UNKNOWN", vouched: o?.evidence, texts: o ? [o.text] : [], source: "",
    });
  }
  add(dir: string, where: string): any | null {
    const pkg = readJson(join(dir, "package.json"));
    if (!pkg?.name || pkg.name.startsWith("@rustybuns/") || pkg.name === "tscircuit-desktop") return pkg;
    const key = `${pkg.name}@${pkg.version}`;
    const existing = this.byKey.get(key);
    if (existing) { existing.where.add(where); return pkg; }
    let license = licenseOf(pkg);
    let texts = licenseTexts(dir);
    let vouched: string | undefined;
    const o = overrides[pkg.name];
    if (license === "UNKNOWN" && o) { license = o.license; vouched = o.evidence; if (!texts.length) texts = [o.text]; }
    this.byKey.set(key, {
      name: pkg.name, version: pkg.version ?? "?", license, texts, vouched, where: new Set([where]),
      source: typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? "",
    });
    return pkg;
  }
  /** A package and everything it depends on at runtime. */
  closure(roots: [string, string][], where: string, rootDir?: string) {
    const seen = new Set<string>();
    const queue = [...roots];
    while (queue.length) {
      const [name, from] = queue.shift()!;
      const dir = rootDir && seen.size === 0 ? rootDir : findPackage(name, from);
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      const pkg = this.add(dir, where);
      if (!pkg) continue;
      for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) queue.push([dep, dir]);
    }
  }
}

async function rustEntries(): Promise<Entry[]> {
  const manifest = join(APP, "native", "Cargo.toml");
  if (!existsSync(manifest)) return [];
  const raw = run("cargo", ["metadata", "--format-version", "1", "--manifest-path", manifest]);
  if (!raw) return [];   // no cargo: the binary has no native engine either
  const meta = JSON.parse(raw);
  const byId = new Map<string, any>(meta.packages.map((p: any) => [p.id, p]));
  const nodes = new Map<string, any>(meta.resolve.nodes.map((n: any) => [n.id, n]));
  const out = new Map<string, Entry>();
  const queue: string[] = [...meta.workspace_members];
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const pkg = byId.get(id);
    // proc-macros run at compile time; they and their deps are not in the library
    if (!pkg || pkg.targets.some((t: any) => t.kind.includes("proc-macro"))) continue;
    if (!meta.workspace_members.includes(id)) {
      out.set(id, {
        name: pkg.name, version: pkg.version, where: new Set(["native"]),
        license: pkg.license ?? "UNKNOWN", source: pkg.repository ?? "",
        texts: licenseTexts(dirname(pkg.manifest_path)),
      });
    }
    for (const dep of nodes.get(id)?.deps ?? []) if (dep.dep_kinds.some((k: any) => k.kind === null)) queue.push(dep.pkg);
  }
  return [...out.values()];
}

/** Every AND term needs at least one permissive choice: "(MIT OR Apache-2.0) AND Unicode-3.0". */
export function isPermissive(expr: string): boolean {
  return expr.replace(/[()]/g, "").split(/\s+AND\s+/i)
    .every((term) => term.split(/\s+OR\s+|\//i).some((l) => PERMISSIVE.test(l.trim())));
}

function render(entries: Entry[]): string {
  const block = (e: Entry) => [
    "-".repeat(78),
    `${e.name}@${e.version}`,
    `License: ${e.license}${e.vouched ? (e.version.includes("not installed") ? ` (verified at ${e.vouched})` : ` (not declared in the package; verified at ${e.vouched})`) : ""}`,
    ...(e.source ? [`Source: ${e.source}`] : []),
    `Used in: ${[...e.where].sort().join(", ")}`,
    "",
    e.texts.length ? e.texts.join("\n\n") : "(no license text shipped with the package; see the identifier above)",
    "",
  ].join("\n");
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return `THIRD-PARTY SOFTWARE NOTICES

tscircuit desktop includes the third-party software listed below. Each
component is distributed under its own license, reproduced here.
Generated by scripts/licenses.ts at build time. Do not edit by hand.

${"=".repeat(78)}
Bun runtime ${bunVersion()}
${"=".repeat(78)}
This application is a compiled Bun executable and embeds the Bun runtime
(MIT License, https://github.com/oven-sh/bun). Bun bundles further
third-party components, including JavaScriptCore/WebKit (LGPL-2.0). Their
notices and Bun's guidance for compiled executables:
  https://bun.sh/docs/project/licensing
  https://github.com/oven-sh/bun/blob/main/LICENSE.md

${"=".repeat(78)}
Components (${sorted.length})
${"=".repeat(78)}
${sorted.map(block).join("\n")}`;
}

export async function collectNotices(opts: { uiPackageDirs?: string[] } = {}): Promise<Notices> {
  const reg = new Registry();
  if (opts.uiPackageDirs) {
    for (const d of opts.uiPackageDirs) reg.add(d, "ui");
  } else {
    const root = readJson(join(APP, "package.json"));
    reg.closure(Object.keys(root.dependencies ?? {}).map((n) => [n, APP]), "dependencies (unbundled estimate)");
  }
  reg.closure(HOST_ROOTS.map((n) => [n, APP]), "host");
  for (const [name, skip] of Object.entries(PREBUNDLED)) {
    const dir = findPackage(name, APP);
    const pkg = dir && readJson(join(dir, "package.json"));
    if (!pkg) continue;
    for (const [dep, spec] of Object.entries<string>(pkg.devDependencies ?? {})) {
      if (!skip.test(dep)) reg.addBaked(dep, spec, `ui (inside ${name})`);
    }
  }
  const entries = [...reg.byKey.values(), ...(await rustEntries())];
  const flagged = entries.filter((e) => !isPermissive(e.license));
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.license, (counts.get(e.license) ?? 0) + 1);
  const vouched = entries.filter((e) => e.vouched).length;
  const summary = [
    `licenses: ${entries.length} components (${entries.filter((e) => e.where.has("ui")).length} ui, ` +
      `${entries.filter((e) => e.where.has("host")).length} host, ${entries.filter((e) => e.where.has("native")).length} native) + Bun runtime`,
    ...[...counts].sort((a, b) => b[1] - a[1]).map(([l, n]) => `  ${String(n).padStart(4)}  ${l}`),
    ...(vouched ? [`  ${vouched} verified via licenses/overrides.json`] : []),
    ...(flagged.length ? [`review before distributing (${flagged.length}):`, ...flagged.map((e) => `  ${e.name}@${e.version}: ${e.license} [${[...e.where].join(", ")}]`)] : []),
  ].join("\n");
  return { text: render(entries), entries, flagged, summary };
}

export function writeNotices(text: string, dirs: string[]) {
  for (const d of dirs) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "THIRD_PARTY_LICENSES.txt"), text);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const n = await collectNotices();
  console.log(n.summary);
  console.log("\n(estimate from package.json; `bun run build` writes the exact file)");
  process.exit(n.flagged.length ? 1 : 0);
}
