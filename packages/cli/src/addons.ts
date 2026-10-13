// desktop.server's native addons (.node files: better-sqlite3, bcrypt, sharp). An addon the server
// requires by a static path is carried: Bun.build emits it beside the bundle and the bundle requires
// it from there, so it ships in the binary with the bundle. One a package finds at run time (through
// `bindings`, `node-gyp-build`, a path it joins) stays where it was on the build machine, so the
// build names it and stops rather than ship a binary that crashes on its first require.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
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

export interface ServerAddons {
  /** The .node files Bun.build emitted beside the bundle: their names there. */
  carried: string[];
  /** Packages in the bundle that load an addon the bundle doesn't carry. */
  missed: { pkg: string; files: string[] }[];
}

/**
 * The addons of one server's bundle, from Bun.build's result (`metafile: true`): the ones it
 * carried, and the packages in it whose addon it couldn't (no carried .node file came from them).
 */
export function serverAddons(r: { outputs: { path: string }[]; metafile?: { inputs: Record<string, unknown> } }, cwd = process.cwd()): ServerAddons {
  const inputs = Object.keys(r.metafile?.inputs ?? {});
  const carried = r.outputs.map((o) => o.path).filter((p) => p.endsWith(".node")).map((p) => basename(p));
  const carriedFrom = inputs.filter((f) => f.endsWith(".node")).map((f) => resolve(cwd, f).split(sep).join("/"));
  const missed: ServerAddons["missed"] = [];
  for (const dir of inputPackages(inputs, cwd)) {
    if (carriedFrom.some((f) => f.startsWith(dir + "/"))) continue;
    const files = nativeFiles(dir);
    if (!files.length) continue;
    const pkg = (() => { try { return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name as string; } catch { return basename(dir); } })();
    missed.push({ pkg, files: files.map((f) => f.slice(dir.length + 1).split(sep).join("/")) });
  }
  return { carried, missed };
}

/** The build's error for an addon it can't carry, or that doesn't load on a target; null when all is well. */
export function addonProblems(entry: string, a: ServerAddons, outdir: string, targets: DesktopOs[] | null): string | null {
  const lines: string[] = [];
  for (const m of a.missed) {
    lines.push(`  ${m.pkg} loads a native addon (${m.files.slice(0, 3).join(", ")}${m.files.length > 3 ? ", ..." : ""}) by a path it works out at run time, so the bundle can't carry it`);
  }
  if (targets) {
    // A package that ships a prebuilt per OS (napi-rs: bcrypt.darwin-arm64.node, bcrypt.linux-x64-gnu.node)
    // picks the one for where it runs, so each addon, by name, needs one build per target, not every build every target.
    const byAddon = new Map<string, { name: string; on: DesktopOs[] }[]>();
    for (const name of a.carried) {
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
  }
  if (!lines.length) return null;
  return `desktop.server ${entry}: native addons the binary can't run\n${lines.join("\n")}\n`
    + `Use a pure-JS package in its place (bun:sqlite for better-sqlite3, bcryptjs for bcrypt), or port the routes to desktop/host.ts (AGENT_PROMPTS.md, prompt 3).`;
}

/** The addon a carried file is a build of: "server-0-bcrypt.darwin-arm64-1a2b3c4d.node" -> "bcrypt". */
export const addonName = (carried: string) => carried.replace(/^server-\d+-/, "").replace(/-[a-z0-9]+\.node$/, "").split(".")[0]!;

/** Beside server-<i>.js: the addon file names it requires, for the host to copy out of the binary with it. */
export const addonsManifest = (bundle: string) => bundle.replace(/\.js$/, ".addons.json");
