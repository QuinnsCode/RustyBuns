// desktop.server's native addons (.node files: better-sqlite3, bcrypt, sharp). An addon the server
// requires by a static path is carried: Bun.build emits it beside the bundle and the bundle requires
// it from there, so it ships in the binary with the bundle. A package that finds its addon at run
// time through `bindings` or `node-gyp-build` gets those swapped for a module that requires the file
// they'd find by a static path (`addonLookups`), so it's carried too; for node-gyp-build that's the
// file each target loads, from the package's prebuilds/<os>-<arch>/, so one machine builds them all.
// One found any other way (a path the package joins, sharp's @img/sharp-<os>-<arch>) stays where it
// was on the build machine, so the build names it and stops rather than ship a binary that crashes
// on its first require.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

/** A package's node-gyp-build lookup: the file each target loads, and the targets it has none for. */
export interface TargetLookup { pkg: string; files: string[]; missing: DesktopOs[] }

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
export function addonLookups(targets: DesktopOs[], found: TargetLookup[] = []): BunPlugin {
  const req = (f: string) => `() => require(${JSON.stringify(f)})`;
  return {
    name: "rustybuns-addon-lookups",
    setup(b) {
      b.onResolve({ filter: /^(bindings|node-gyp-build)$/ }, (a) => a.importer && !a.importer.startsWith(LOOKUP_NS)
        ? { path: packageDir(a.importer), namespace: LOOKUP_NS + a.path } : undefined);
      b.onLoad({ filter: /.*/, namespace: LOOKUP_NS + "bindings" }, (a) => {
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
    },
  };
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
export function addonProblems(entry: string, a: ServerAddons, targets: DesktopOs[] | null): string | null {
  const lines: string[] = [];
  for (const m of a.missed) {
    lines.push(`  ${m.pkg} loads a native addon (${m.files.slice(0, 3).join(", ")}${m.files.length > 3 ? ", ..." : ""}) by a path it works out at run time, so the bundle can't carry it`);
  }
  if (targets) {
    // A package that ships a prebuilt per OS (napi-rs: bcrypt.darwin-arm64.node, bcrypt.linux-x64-gnu.node)
    // picks the one for where it runs, so each addon, by name, needs one build per target, not every build every target.
    const picked = new Set(a.perTarget.flatMap((l) => l.files.map((f) => f.split(sep).join("/"))));
    const byAddon = new Map<string, string[]>();
    for (const p of a.sources) {
      if (picked.has(p)) continue;                             // one target's file, checked below
      byAddon.set(addonName(p), [...byAddon.get(addonName(p)) ?? [], p]);
    }
    for (const [addon, builds] of byAddon) {
      const on = [...new Set(builds.flatMap(headerOf))], off = targets.filter((t) => !on.includes(t));
      const p = builds[0]!, name = builds.length > 1 ? `${addon}.node` : p.includes("/node_modules/") ? p.slice(p.lastIndexOf("/node_modules/") + 14) : basename(p);
      if (off.length) lines.push(`  ${name} is built for ${on.join(", ") || "an OS we don't know"}, so it won't load on ${off.join(", ")}: install its prebuilt for them (\`bun install --os '*' --cpu '*'\` fetches every OS's build a package offers), or build those targets on their own OS`);
    }
    for (const l of a.perTarget) {
      const off = l.missing.filter((t) => targets.includes(t));
      if (off.length) lines.push(`  ${l.pkg} has no addon for ${off.join(", ")} (node-gyp-build looks in build/Release and prebuilds/<os>-<arch>/): build those targets on their own OS, or install a version that ships their prebuilds`);
    }
  }
  if (!lines.length) return null;
  return `desktop.server ${entry}: native addons the binary can't run\n${lines.join("\n")}\n`
    + `Use a pure-JS package in its place (bun:sqlite for better-sqlite3, bcryptjs for bcrypt), or port the routes to desktop/host.ts (AGENT_PROMPTS.md, prompt 3).`;
}

/** The addon a .node file is a build of: ".../bcrypt.darwin-arm64.node" -> "bcrypt". */
export const addonName = (file: string) => basename(file).split(".")[0]!;

/** Beside server-<i>.js: the addon file names it requires, for the host to copy out of the binary with it. */
export const addonsManifest = (bundle: string) => bundle.replace(/\.js$/, ".addons.json");
