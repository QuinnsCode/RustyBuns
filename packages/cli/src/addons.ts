// desktop.server's native addons (.node files: better-sqlite3, bcrypt, sharp). An addon the server
// requires by a static path is carried: Bun.build emits it beside the bundle and the bundle requires
// it from there, so it ships in the binary with the bundle. A package that finds its addon at run
// time through `bindings` or `node-gyp-build` gets those swapped for a module that requires the file
// they'd find by a static path (`addonLookups`), so it's carried too; for node-gyp-build that's the
// file each target loads, from the package's prebuilds/<os>-<arch>/, so one machine builds them all.
// A bindings package installed by prebuild-install (sqlite3, better-sqlite3 up to 12) only has the
// installing machine's file, built for the installing Node's ABI, so each target's comes from the
// package's release for Bun's ABI (or N-API), the way prebuild-install fetches it. better-sqlite3 13
// ships every target's in prebuilds/<os>-<arch>.node, and its loader gets a static require per target.
// sharp loads @img/sharp-<os>-<arch>'s addon, which links @img/sharp-libvips-<os>-<arch>'s library by
// a relative rpath: both go in a tree beside the bundle (`server-<i>-native/@img/...`), fetched from
// the npm registry for the targets npm didn't install. One found any other way (a path the package
// joins) stays where it was on the build machine, so the build names it and stops rather than ship a
// binary that crashes on its first require.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { BunPlugin } from "bun";
import type { DesktopOs } from "./config.ts";

/** Which OS-arch a .node file loads on, from its header; [] when it isn't a binary we know. */
export function addonPlatforms(bytes: Uint8Array): DesktopOs[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 64) return [];
  const mach = (cpu: number): DesktopOs | null => cpu === 0x0100000c ? "darwin-arm64" : cpu === 0x01000007 ? "darwin-x64" : null;
  // Mach-O, 64-bit little-endian.
  if (v.getUint32(0, true) === 0xfeedfacf) return [mach(v.getUint32(4, true))].filter((t): t is DesktopOs => !!t);
  // A universal (fat) Mach-O: one slice per arch, big-endian headers.
  if (v.getUint32(0) === 0xcafebabe) {
    const n = Math.min(v.getUint32(4), 8), out: DesktopOs[] = [];
    for (let i = 0; i < n && 8 + i * 20 + 4 <= bytes.length; i++) { const t = mach(v.getUint32(8 + i * 20)); if (t) out.push(t); }
    return out;
  }
  // ELF: e_machine.
  if (v.getUint32(0) === 0x7f454c46) {
    const m = v.getUint16(18, true);
    return m === 0x3e ? ["linux-x64"] : m === 0xb7 ? ["linux-arm64"] : [];
  }
  // PE: the COFF header's machine, after "PE\0\0".
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) {
    const pe = v.getUint32(0x3c, true);
    if (pe + 6 > bytes.length || v.getUint32(pe) !== 0x50450000) return [];
    return v.getUint16(pe + 4, true) === 0x8664 ? ["windows-x64"] : [];
  }
  return [];
}

/** The package dirs (node_modules/x, node_modules/@s/x) the bundle's inputs came from. */
export function inputPackages(inputs: string[], cwd = process.cwd()): string[] {
  const dirs = new Set<string>();
  for (const f of inputs) {
    if (f.startsWith(LOOKUP_NS)) continue;                    // addonLookups' modules
    const abs = resolve(cwd, f).split(sep).join("/");
    const m = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(abs);
    if (m) dirs.add(m[1]!);
  }
  return [...dirs];
}

/** A package's own .node files, and whether it builds one (binding.gyp): its nested node_modules aside. */
function nativeFiles(dir: string, depth = 0): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const out: string[] = [];
  for (const n of names) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (n.endsWith(".node") || n === "binding.gyp") { out.push(p); continue; }
    if (depth < 4) { try { if (statSync(p).isDirectory()) out.push(...nativeFiles(p, depth + 1)); } catch {} }
  }
  return out;
}

const LOOKUP_NS = "rb-addon-";
const pkgName = (dir: string) => { try { return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name as string; } catch { return basename(dir); } };
const headerOf = (f: string) => { try { return addonPlatforms(readFileSync(f)); } catch { return []; } };
/** A DesktopOs as Node names it (process.platform-process.arch), as prebuilds/ dirs are named. */
const nodeTag = (t: DesktopOs) => t.replace(/^windows-/, "win32-");

/**
 * A package's lookup by target (node-gyp-build, prebuild-install, sharp): the files it carries, the
 * targets it has none for and why, and for sharp the tree it lays out beside the bundle (path in
 * the tree -> source file).
 */
export interface TargetLookup { pkg: string; files: string[]; missing: DesktopOs[]; why?: string; tree?: Record<string, string> }

/** Where fetched prebuilds are kept between builds. */
const DEFAULT_CACHE = "node_modules/.cache/rustybuns/addons";

/** A .tar.gz at `url`, unpacked into `dest` (cached: a second build doesn't fetch it); null when it isn't there. */
export async function fetchTarball(url: string, dest: string, strip = 0): Promise<string | null> {
  if (existsSync(join(dest, ".rb-fetched"))) return dest;
  const r = await fetch(url).catch(() => null);
  if (!r?.ok) return null;
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const tgz = dest + ".tgz";
  writeFileSync(tgz, new Uint8Array(await r.arrayBuffer()));
  const x = Bun.spawnSync(["tar", "-xzf", tgz, "-C", dest, ...(strip ? [`--strip-components=${strip}`] : [])], { stdout: "ignore", stderr: "pipe" });
  rmSync(tgz, { force: true });
  if (x.exitCode !== 0) { rmSync(dest, { recursive: true, force: true }); throw new Error(`unpacking ${url}: ${x.stderr.toString().trim()}`); }
  writeFileSync(join(dest, ".rb-fetched"), url);
  return dest;
}

const readPkg = (dir: string): Record<string, any> => { try { return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { return {}; } };

/** A package `name` as node would find it from `from`: in a node_modules dir at or above it. */
function findPackage(from: string, name: string): string | null {
  for (let d = from; ; d = dirname(d)) {
    const p = join(d, "node_modules", name);
    if (existsSync(join(p, "package.json"))) return p;
    if (dirname(d) === d) return null;
  }
}

/** An npm package's tarball, from the registry npm uses (npm_config_registry), unpacked into the cache. */
function fetchNpm(name: string, version: string, cache: string) {
  const registry = (process.env.npm_config_registry || "https://registry.npmjs.org").replace(/\/$/, "");
  return fetchTarball(`${registry}/${name}/-/${name.split("/").pop()}-${version}.tgz`, join(cache, "npm", `${name}@${version}`), 1);
}

/**
 * The URL prebuild-install downloads a package's prebuilt from, for target `t`: the
 * npm_config_<name>_binary_host(_mirror) mirror, else the package's binary.host, else its GitHub
 * release. The ABI is the building Bun's, which is the one the binary runs.
 */
export function prebuildUrl(pkg: Record<string, any>, t: DesktopOs): string | null {
  const name = String(pkg.name).replace(/^@[^/]+\//, ""), [platform, arch] = nodeTag(t).split("-") as [string, string];
  const file = "{name}-v{version}-{runtime}-v{abi}-{platform}{libc}-{arch}.tar.gz";
  const key = String(pkg.name).replace(/[^a-zA-Z0-9]+/g, "_");
  const mirror = process.env[`npm_config_${key}_binary_host_mirror`] || process.env[`npm_config_${key}_binary_host`];
  let template: string;
  if (mirror) template = `${mirror.replace(/\/$/, "")}/{tag_prefix}{version}/${file}`;
  else if (pkg.binary?.host) template = [pkg.binary.host, pkg.binary.remote_path, pkg.binary.package_name || file].filter(Boolean).map((s: string) => s.replace(/\/$/, "")).join("/");
  else {
    const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    const m = repo && /github(?:\.com[/:]|:)([^/]+\/[^/#]+?)(?:\.git)?(?:#.*)?$/.exec(repo);
    if (!m) return null;
    template = `https://github.com/${m[1]}/releases/download/{tag_prefix}{version}/${file}`;
  }
  // `prebuild-install -r napi` (sqlite3): an N-API build, the newest of binary.napi_versions Bun has.
  const napis: number[] = (pkg.binary?.napi_versions ?? []).filter((v: number) => v <= Number(process.versions.napi));
  const napi = /(-r|--runtime)[ =]napi\b/.test(pkg.scripts?.install ?? "") ? (napis.length ? Math.max(...napis) : Number(process.versions.napi)) : null;
  const vars: Record<string, string> = { name, package_name: name, version: pkg.version, runtime: napi ? "napi" : "node", abi: String(napi ?? process.versions.modules),
    platform, libc: "", arch, tag_prefix: "v", configuration: "Release" };
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

/** Whether a package gets its addon from prebuild-install at install time. */
const usesPrebuildInstall = (pkg: Record<string, any>) => !!(pkg.dependencies?.["prebuild-install"] || /prebuild-install/.test(pkg.scripts?.install ?? ""));

/**
 * sharp's addon for each target: @img/sharp-<os>-<arch>'s lib/ (the .node, and on Windows its
 * DLLs) and @img/sharp-libvips-<os>-<arch>'s libraries, as installed or else fetched at the version
 * sharp pins, laid out as in node_modules so the addon's rpath (../../sharp-libvips-<os>-<arch>/lib)
 * finds libvips. `node` is each target's .node in the tree.
 */
export async function sharpFiles(sharpDir: string, targets: DesktopOs[], cache: string) {
  const pins: Record<string, string> = readPkg(sharpDir).optionalDependencies ?? {};
  const tree: Record<string, string> = {}, node: Partial<Record<DesktopOs, string>> = {}, missing: DesktopOs[] = [];
  const libs = (dir: string) => { try { return readdirSync(dir).filter((n) => !/\.(js|json|h)$/.test(n) && statSync(join(dir, n)).isFile()); } catch { return []; } };
  for (const t of targets) {
    const plat = nodeTag(t), addon = `@img/sharp-${plat}`, vips = `@img/sharp-libvips-${plat}`;
    const get = async (n: string) => findPackage(sharpDir, n) ?? (pins[n] ? await fetchNpm(n, pins[n]!, cache) : null);
    const a = await get(addon), f = a && libs(join(a, "lib")).find((n) => n.endsWith(".node"));
    if (!a || !f || !headerOf(join(a, "lib", f)).includes(t)) { missing.push(t); continue; }
    const v = pins[vips] ? await get(vips) : null;              // Windows has none: the DLLs are in the addon's own lib/
    if (pins[vips] && !v) { missing.push(t); continue; }
    for (const n of libs(join(a, "lib"))) tree[`${addon}/lib/${n}`] = join(a, "lib", n);
    if (v) for (const n of libs(join(v, "lib"))) tree[`${vips}/lib/${n}`] = join(v, "lib", n);
    node[t] = `${addon}/lib/${f}`;
  }
  return { tree, node, missing };
}

/**
 * The file node-gyp-build would load on `t`: the package's own build (build/Release, then
 * build/Debug) when it's built for t, else the prebuild in prebuilds/<os>-<arch>[+<arch>]/, N-API
 * over an ABI-tagged one and glibc over musl, skipping electron's.
 */
export function gypBuildFile(dir: string, t: DesktopOs): string | null {
  for (const b of ["build/Release", "build/Debug"]) {
    let names: string[] = [];
    try { names = readdirSync(join(dir, b)).filter((n) => n.endsWith(".node")); } catch {}
    if (names[0] && headerOf(join(dir, b, names[0])).includes(t)) return join(dir, b, names[0]);
  }
  const [os, arch] = nodeTag(t).split("-") as [string, string];
  let dirs: string[] = [];
  try { dirs = readdirSync(join(dir, "prebuilds")); } catch {}
  for (const d of dirs) {
    const [dOs, archs = ""] = d.split("-");
    if (dOs !== os || !archs.split("+").includes(arch)) continue;
    let names: string[] = [];
    try { names = readdirSync(join(dir, "prebuilds", d)).filter((n) => n.endsWith(".node") && !n.includes("electron")); } catch {}
    const rank = (n: string) => (n.includes("musl") ? 2 : 0) + (n.includes("napi") ? 0 : 1);
    for (const n of names.sort((a, b) => rank(a) - rank(b))) {
      const f = join(dir, "prebuilds", d, n);
      if (headerOf(f).includes(t)) return f;
    }
  }
  return null;
}

/**
 * The file `bindings("name")` would load for each name: bindings tries build/Release first, then
 * the other build dirs, so a name built twice gets the first of those.
 */
export function bindingsFiles(dir: string): Record<string, string> {
  const order = ["build/Release/", "build/Debug/", "out/Release/", "Release/", "out/Debug/", "Debug/", "build/default/"];
  const rank = (rel: string) => { const i = order.findIndex((o) => rel.startsWith(o)); return i < 0 ? order.length : i; };
  const out: Record<string, string> = {};
  const files = nativeFiles(dir).filter((f) => f.endsWith(".node")).map((f) => f.slice(dir.length + 1).split(sep).join("/"));
  for (const rel of files.sort((a, b) => rank(a) - rank(b))) out[basename(rel)] ??= join(dir, rel);
  return out;
}

/** The package dir a file belongs to: the nearest one up with a package.json. */
function packageDir(file: string): string {
  for (let d = dirname(file); ; d = dirname(d)) {
    if (existsSync(join(d, "package.json")) || dirname(d) === d) return d;
  }
}

/**
 * A Bun.build plugin that swaps `require("bindings")` and `require("node-gyp-build")` for a module
 * of static requires of the files they'd find, so Bun.build carries them. node-gyp-build's picks
 * one file per target and chooses by process.platform-process.arch when it runs; each lookup it
 * writes goes in `found`, with the targets it found no file for.
 */
export function addonLookups(targets: DesktopOs[], found: TargetLookup[] = [], o: { tree?: string; cache?: string } = {}): BunPlugin {
  const treeDir = o.tree ?? "native", cache = resolve(o.cache ?? DEFAULT_CACHE);
  const req = (f: string) => `() => require(${JSON.stringify(f)})`;
  return {
    name: "rustybuns-addon-lookups",
    setup(b) {
      b.onResolve({ filter: /^(bindings|node-gyp-build)$/ }, (a) => a.importer && !a.importer.startsWith(LOOKUP_NS)
        ? { path: packageDir(a.importer), namespace: LOOKUP_NS + a.path } : undefined);
      b.onLoad({ filter: /.*/, namespace: LOOKUP_NS + "bindings" }, async (a) => {
        const pkg = readPkg(a.path);
        if (usesPrebuildInstall(pkg) && targets.length) return { loader: "js", contents: await prebuildLookup(a.path, pkg) };
        const files = Object.entries(bindingsFiles(a.path)).map(([n, f]) => `  ${JSON.stringify(n)}: ${req(f)},`);
        return { loader: "js", contents: `const files = {\n${files.join("\n")}\n};
module.exports = function bindings(o) {
  let n = typeof o === "string" ? o : (o && o.bindings) || "bindings.node";
  if (!n.endsWith(".node")) n += ".node";
  if (!files[n]) throw new Error("bindings: " + n + " wasn't in ${pkgName(a.path)} when this binary was built");
  return files[n]();
};
` };
      });
      b.onLoad({ filter: /.*/, namespace: LOOKUP_NS + "node-gyp-build" }, (a) => {
        const pick = targets.map((t) => [t, gypBuildFile(a.path, t)] as const);
        const has = pick.filter((p): p is readonly [DesktopOs, string] => !!p[1]);
        found.push({ pkg: pkgName(a.path), files: [...new Set(has.map((p) => p[1]))], missing: pick.filter((p) => !p[1]).map((p) => p[0]) });
        return { loader: "js", contents: `const files = {\n${has.map(([t, f]) => `  ${JSON.stringify(nodeTag(t))}: ${req(f)},`).join("\n")}\n};
module.exports = function load() {
  const k = process.platform + "-" + process.arch;
  if (!files[k]) throw new Error("node-gyp-build: ${pkgName(a.path)} has no addon for " + k + " in this binary");
  return files[k]();
};
` };
      });
      // better-sqlite3 13's loader, which joins prebuilds/<os>-<arch>.node at run time: a static require per target.
      b.onLoad({ filter: /[\\/]better-sqlite3[\\/]lib[\\/]binding\.js$/ }, async (a) => {
        const src = await Bun.file(a.path).text();
        if (!/getPrebuildPath/.test(src)) return undefined;     // another version's: left to the check
        const dir = dirname(dirname(a.path)), pick = targets.map((t) => [t, [join(dir, "prebuilds", `${nodeTag(t)}.node`), join(dir, "build/Release/better_sqlite3.node")]
          .find((f) => existsSync(f) && headerOf(f).includes(t))] as const);
        const has = pick.filter((p): p is readonly [DesktopOs, string] => !!p[1]);
        found.push({ pkg: pkgName(dir), files: [...new Set(has.map((p) => p[1]))], missing: pick.filter((p) => !p[1]).map((p) => p[0]), why: "better-sqlite3 looks in prebuilds/<os>-<arch>.node and build/Release" });
        return { loader: "js", contents: `const path = require("path");
const files = {\n${has.map(([t, f]) => `  ${JSON.stringify(nodeTag(t))}: ${req(f)},`).join("\n")}\n};
let DEFAULT_ADDON;
exports.getBinding = function getBinding(nativeBinding) {
  if (typeof nativeBinding === "string") return require(path.resolve(nativeBinding).replace(/(\\.node)?$/, ".node"));
  if (typeof nativeBinding === "object" && nativeBinding !== null) return nativeBinding;
  if (DEFAULT_ADDON) return DEFAULT_ADDON;
  const k = process.platform + "-" + process.arch;
  if (!files[k]) throw new Error("better-sqlite3 has no addon for " + k + " in this binary");
  return DEFAULT_ADDON = files[k]();
};
exports.getPrebuildPath = () => null;
` };
      });
      // sharp's loader, which works out @img/sharp-<os>-<arch> at run time: it requires the tree's instead.
      b.onLoad({ filter: /[\\/]sharp[\\/](lib[\\/]sharp\.js|dist[\\/]sharp\.[cm]js)$/ }, async (a) => {
        const { tree, node, missing } = await sharpFiles(dirname(dirname(a.path)), targets, cache);
        found.push({ pkg: "sharp", files: Object.values(node).map((n) => tree[n!]!), missing, tree,
          why: "no @img/sharp-<os>-<arch> installed, or on the npm registry at the version sharp pins" });
        const files = Object.entries(node).map(([t, f]) => `  ${JSON.stringify(nodeTag(t as DesktopOs))}: ${JSON.stringify(`${treeDir}/${f}`)},`);
        const load = `const files = {\n${files.join("\n")}\n};
const k = process.platform + "-" + process.arch;
if (!files[k]) throw new Error("sharp: no @img/sharp-" + k + " in this binary");
const sharp = require(import.meta.dir + "/" + files[k]);
`;
        return a.path.endsWith(".mjs")
          ? { loader: "js", contents: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n${load}export default sharp;\n` }
          : { loader: "js", contents: `${load}module.exports = sharp;\n` };
      });
    },
  };

  /**
   * bindings for a prebuild-install package: each target's prebuild for Bun's ABI, fetched. The
   * installed file was fetched for the Node that ran the install, whose ABI Bun refuses, so it's
   * only the fallback, on the targets it loads on.
   */
  async function prebuildLookup(dir: string, pkg: Record<string, any>) {
    const names = Object.entries(bindingsFiles(dir)), files: Record<string, Partial<Record<DesktopOs, string>>> = {}, missing = new Set<DesktopOs>();
    for (const t of targets) {
      const url = prebuildUrl(pkg, t);
      const got = url ? await fetchTarball(url, join(cache, "prebuild", basename(url, ".tar.gz"))) : null;
      for (const [n, installed] of names) {
        const f = [got && join(got, "build/Release", n), installed].find((f) => f && existsSync(f) && headerOf(f).includes(t));
        if (f) (files[n] ??= {})[t] = f;
        else missing.add(t);
      }
    }
    const url = prebuildUrl(pkg, targets[0]!);
    found.push({ pkg: pkgName(dir), files: [...new Set(Object.values(files).flatMap((m) => Object.values(m) as string[]))], missing: [...missing],
      why: url ? `prebuild-install's release has none: ${url.replace(/[^/]*$/, "")}` : "nothing to fetch: the package names no GitHub repository or binary.host" });
    const body = Object.entries(files).map(([n, m]) => `  ${JSON.stringify(n)}: {\n${Object.entries(m).map(([t, f]) => `    ${JSON.stringify(nodeTag(t as DesktopOs))}: ${req(f!)},`).join("\n")}\n  },`);
    return `const files = {\n${body.join("\n")}\n};
module.exports = function bindings(o) {
  let n = typeof o === "string" ? o : (o && o.bindings) || "bindings.node";
  if (!n.endsWith(".node")) n += ".node";
  const k = process.platform + "-" + process.arch;
  if (!files[n]) throw new Error("bindings: " + n + " wasn't in ${pkgName(dir)} when this binary was built");
  if (!files[n][k]) throw new Error("bindings: ${pkgName(dir)} has no " + n + " for " + k + " in this binary");
  return files[n][k]();
};
`;
  }
}

/** Lays out the lookups' trees (sharp's) under `dir`/`treeDir`, beside the bundle: the paths written, for its manifest. */
export function copyTrees(dir: string, treeDir: string, lookups: TargetLookup[]): string[] {
  const out: string[] = [];
  for (const l of lookups) for (const [to, from] of Object.entries(l.tree ?? {})) {
    mkdirSync(dirname(join(dir, treeDir, to)), { recursive: true });
    copyFileSync(from, join(dir, treeDir, to));
    out.push(`${treeDir}/${to}`);
  }
  return out;
}

export interface ServerAddons {
  /** The .node files Bun.build emitted beside the bundle: their names there. */
  carried: string[];
  /** Where they came from: the .node files the bundle requires, absolute. */
  sources: string[];
  /** node-gyp-build lookups, carried a file per target (addonLookups' `found`). */
  perTarget: TargetLookup[];
  /** Packages in the bundle that load an addon the bundle doesn't carry. */
  missed: { pkg: string; files: string[] }[];
}

/**
 * The addons of one server's bundle, from Bun.build's result (`metafile: true`): the ones it
 * carried, and the packages in it whose addon it couldn't (no carried .node file came from them).
 */
export function serverAddons(r: { outputs: { path: string }[]; metafile?: { inputs: Record<string, unknown> } }, perTarget: TargetLookup[] = [], cwd = process.cwd()): ServerAddons {
  const inputs = Object.keys(r.metafile?.inputs ?? {});
  const carried = r.outputs.map((o) => o.path).filter((p) => p.endsWith(".node")).map((p) => basename(p));
  const carriedFrom = inputs.filter((f) => f.endsWith(".node")).map((f) => resolve(cwd, f).split(sep).join("/"));
  const missed: ServerAddons["missed"] = [];
  for (const dir of inputPackages(inputs, cwd)) {
    if (perTarget.some((l) => l.pkg === pkgName(dir))) continue; // named by its own line
    if (carriedFrom.some((f) => f.startsWith(dir + "/"))) continue;
    const files = nativeFiles(dir);
    if (!files.length) continue;
    missed.push({ pkg: pkgName(dir), files: files.map((f) => f.slice(dir.length + 1).split(sep).join("/")) });
  }
  return { carried, sources: carriedFrom, perTarget, missed };
}

/** The build's error for an addon it can't carry, or that doesn't load on a target; null when all is well. */
export function addonProblems(entry: string, a: ServerAddons, outdir: string, targets: DesktopOs[] | null): string | null {
  const lines: string[] = [];
  for (const m of a.missed) {
    lines.push(`  ${m.pkg} loads a native addon (${m.files.slice(0, 3).join(", ")}${m.files.length > 3 ? ", ..." : ""}) by a path it works out at run time, so the bundle can't carry it`);
  }
  if (targets) {
    // Lookups by target (node-gyp-build, prebuild-install, better-sqlite3) load one file per target, checked by their own line below.
    const perTargetAddons = new Set(a.perTarget.flatMap((l) => l.files.map((f) => basename(f).split(".")[0]!)));
    // A package that ships a prebuilt per OS (napi-rs: bcrypt.darwin-arm64.node, bcrypt.linux-x64-gnu.node)
    // picks the one for where it runs, so each addon, by name, needs one build per target, not every build every target.
    const byAddon = new Map<string, { name: string; on: DesktopOs[] }[]>();
    for (const name of a.carried) {
      if (perTargetAddons.has(addonName(name))) continue;
      const p = join(outdir, name);
      const on = existsSync(p) ? addonPlatforms(readFileSync(p)) : [];
      const addon = addonName(name);
      byAddon.set(addon, [...byAddon.get(addon) ?? [], { name, on }]);
    }
    for (const [addon, builds] of byAddon) {
      const off = targets.filter((t) => !builds.some((b) => b.on.includes(t)));
      const built = [...new Set(builds.flatMap((b) => b.on))];
      if (off.length) lines.push(`  ${addon}.node is built for ${built.join(", ") || "an OS we don't know"}, so it won't load on ${off.join(", ")}: install its prebuilt for them (\`bun install --os '*' --cpu '*'\` fetches every OS's build a package offers), or build those targets on their own OS`);
    }
    for (const l of a.perTarget) {
      const off = l.missing.filter((t) => targets.includes(t));
      if (off.length) lines.push(`  ${l.pkg} has no addon for ${off.join(", ")} (${l.why ?? "node-gyp-build looks in build/Release and prebuilds/<os>-<arch>/"}): build those targets on their own OS, or install a version that ships their prebuilds`);
    }
  }
  if (!lines.length) return null;
  return `desktop.server ${entry}: native addons the binary can't run\n${lines.join("\n")}\n`
    + `Use a pure-JS package in its place (bun:sqlite for better-sqlite3, bcryptjs for bcrypt), or port the routes to desktop/host.ts (AGENT_PROMPTS.md, prompt 3).`;
}

/** The addon a carried file is a build of: "server-0-bcrypt.darwin-arm64-1a2b3c4d.node" -> "bcrypt". */
export const addonName = (carried: string) => carried.replace(/^server-\d+-/, "").replace(/-[a-z0-9]+\.node$/, "").split(".")[0]!;

/** Beside server-<i>.js: the addon file names it requires, for the host to copy out of the binary with it. */
export const addonsManifest = (bundle: string) => bundle.replace(/\.js$/, ".addons.json");
