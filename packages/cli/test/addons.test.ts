// desktop.server's native addons: the ones its bundle carries, the ones it can't, and which OS
// each carried one loads on.
import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addonLookups, addonName, addonPlatforms, addonProblems, gypBuildFile, serverAddons, type TargetLookup } from "../src/addons.ts";
import type { DesktopOs } from "../src/config.ts";

const root = mkdtempSync(join(import.meta.dir, ".e2e-addons-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A header: the given bytes at their offsets, zeros elsewhere. */
function header(at: Record<number, number[]>, size = 256): Uint8Array {
  const b = new Uint8Array(size);
  for (const [off, bytes] of Object.entries(at)) b.set(bytes, +off);
  return b;
}
const MACHO_ARM64 = header({ 0: [0xcf, 0xfa, 0xed, 0xfe], 4: [0x0c, 0, 0, 0x01] });
const MACHO_X64 = header({ 0: [0xcf, 0xfa, 0xed, 0xfe], 4: [0x07, 0, 0, 0x01] });
const FAT = header({ 0: [0xca, 0xfe, 0xba, 0xbe], 4: [0, 0, 0, 2], 8: [0x01, 0, 0, 0x07], 28: [0x01, 0, 0, 0x0c] });
const ELF_X64 = header({ 0: [0x7f, 0x45, 0x4c, 0x46], 18: [0x3e, 0] });
const ELF_ARM64 = header({ 0: [0x7f, 0x45, 0x4c, 0x46], 18: [0xb7, 0] });
const PE_X64 = header({ 0: [0x4d, 0x5a], 0x3c: [0x80, 0, 0, 0], 0x80: [0x50, 0x45, 0, 0, 0x64, 0x86] });

test("an addon's OS-arch, from its header", () => {
  expect(addonPlatforms(MACHO_ARM64)).toEqual(["darwin-arm64"]);
  expect(addonPlatforms(MACHO_X64)).toEqual(["darwin-x64"]);
  expect(addonPlatforms(FAT)).toEqual(["darwin-x64", "darwin-arm64"]);
  expect(addonPlatforms(ELF_X64)).toEqual(["linux-x64"]);
  expect(addonPlatforms(ELF_ARM64)).toEqual(["linux-arm64"]);
  expect(addonPlatforms(PE_X64)).toEqual(["windows-x64"]);
  expect(addonPlatforms(new TextEncoder().encode("not a binary at all, just some text padding it out past 64 bytes"))).toEqual([]);
});

// A server with two addons: one required by a static path (Bun.build carries it), one found at run
// time by a path the package joins, as `bindings` and `node-gyp-build` do (it can't).
function fixture(dir: string, addon: Uint8Array, dynamic: boolean) {
  const nm = join(dir, "node_modules");
  mkdirSync(join(nm, "staticaddon/build/Release"), { recursive: true });
  writeFileSync(join(nm, "staticaddon/package.json"), '{"name":"staticaddon","main":"index.js"}');
  writeFileSync(join(nm, "staticaddon/index.js"), 'module.exports = require("./build/Release/fast.node");');
  writeFileSync(join(nm, "staticaddon/build/Release/fast.node"), addon);
  mkdirSync(join(nm, "@db/sqlish/build/Release"), { recursive: true });
  writeFileSync(join(nm, "@db/sqlish/package.json"), '{"name":"@db/sqlish","main":"index.js"}');
  writeFileSync(join(nm, "@db/sqlish/binding.gyp"), "{}");
  writeFileSync(join(nm, "@db/sqlish/index.js"), 'const p = require("path"); module.exports = require(p.join(__dirname, "build/Release/sqlish.node"));');
  writeFileSync(join(nm, "@db/sqlish/build/Release/sqlish.node"), ELF_X64);
  writeFileSync(join(dir, "server.js"), `import a from "staticaddon";\n${dynamic ? 'import b from "@db/sqlish";\n' : ""}console.log(a);\n`);
}

async function bundle(dir: string, targets: DesktopOs[] = ["linux-x64"]) {
  const outdir = join(dir, "out"), perTarget: TargetLookup[] = [];
  const r = await Bun.build({ entrypoints: [join(dir, "server.js")], outdir, naming: { entry: "server-0.[ext]", asset: "server-0-[name]-[hash].[ext]" }, target: "bun", metafile: true, plugins: [addonLookups(targets, perTarget)], throw: false } as any);
  expect(r.success).toBe(true);
  return { addons: serverAddons(r as any, perTarget), outdir };
}

test("a static addon is carried; one a package finds at run time is named, and stops the build", async () => {
  const dir = join(root, "both");
  fixture(dir, ELF_X64, true);
  const { addons, outdir } = await bundle(dir);
  expect(addons.carried).toHaveLength(1);
  expect(addons.carried[0]).toMatch(/^server-0-fast-\w+\.node$/);
  expect(readdirSync(outdir).sort()).toEqual([addons.carried[0], "server-0.js"].sort());
  expect(addons.missed).toEqual([{ pkg: "@db/sqlish", files: expect.arrayContaining(["binding.gyp", "build/Release/sqlish.node"]) }]);
  const err = addonProblems("../api/server.js", addons, ["linux-x64"])!;
  expect(err).toContain("desktop.server ../api/server.js: native addons the binary can't run");
  expect(err).toContain("@db/sqlish loads a native addon");
  expect(err).not.toContain("fast");                         // linux-x64 is what it's built for
});

test("a carried addon built for another OS names the targets it won't load on", async () => {
  const dir = join(root, "cross");
  fixture(dir, MACHO_ARM64, false);
  const { addons } = await bundle(dir);
  expect(addons.missed).toEqual([]);
  expect(addonProblems("server.js", addons, ["darwin-arm64"])).toBeNull();
  expect(addonProblems("server.js", addons, null)).toBeNull();      // the dev host: this machine
  const err = addonProblems("server.js", addons, ["darwin-arm64", "linux-x64", "windows-x64"])!;
  expect(err).toContain("staticaddon/build/Release/fast.node is built for darwin-arm64, so it won't load on linux-x64, windows-x64");
});

// better-sqlite3's shape: `require("bindings")("name")`, built into build/Release (and Debug).
test("an addon found through bindings is carried: the build/Release one, by the name asked for", async () => {
  const dir = join(root, "bindings"), nm = join(dir, "node_modules");
  mkdirSync(join(nm, "sqlite-ish/build/Release"), { recursive: true });
  mkdirSync(join(nm, "sqlite-ish/build/Debug"), { recursive: true });
  mkdirSync(join(nm, "sqlite-ish/lib"));
  writeFileSync(join(nm, "sqlite-ish/package.json"), '{"name":"sqlite-ish","main":"lib/index.js"}');
  writeFileSync(join(nm, "sqlite-ish/lib/index.js"), 'module.exports = (n) => require("bindings")(n);');
  writeFileSync(join(nm, "sqlite-ish/build/Release/sqlite_ish.node"), ELF_X64);
  writeFileSync(join(nm, "sqlite-ish/build/Debug/sqlite_ish.node"), MACHO_ARM64);
  mkdirSync(join(nm, "bindings"));
  writeFileSync(join(nm, "bindings/package.json"), '{"name":"bindings","main":"bindings.js"}');
  writeFileSync(join(nm, "bindings/bindings.js"), 'module.exports = (n) => require(require("path").join(process.cwd(), n));');
  writeFileSync(join(dir, "server.js"), 'import open from "sqlite-ish";\nexport { open };\n');
  const { addons, outdir } = await bundle(dir);
  expect(addons.missed).toEqual([]);
  expect(addons.sources).toEqual([join(nm, "sqlite-ish/build/Release/sqlite_ish.node")]);
  expect(addons.carried).toEqual([expect.stringMatching(/^server-0-sqlite_ish-\w+\.node$/)]);
  expect(readFileSync(join(outdir, "server-0.js"), "utf8")).toContain(addons.carried[0]);
  expect(addonProblems("server.js", addons, ["linux-x64"])).toBeNull();
  expect(addonProblems("server.js", addons, ["darwin-arm64"])).toContain("sqlite-ish/build/Release/sqlite_ish.node is built for linux-x64");
  // A name it wasn't built with says so when asked for, without loading anything.
  const { open } = await import(join(outdir, "server-0.js"));
  expect(() => open("other")).toThrow("bindings: other.node wasn't in sqlite-ish when this binary was built");
});

// bcrypt's shape: `require("node-gyp-build")(__dirname)`, with prebuildify's prebuilds/<os>-<arch>/.
function prebuilt(dir: string) {
  const nm = join(dir, "node_modules"), pkg = join(nm, "hashish");
  for (const d of ["darwin-x64+arm64", "linux-x64", "android-arm64"]) mkdirSync(join(pkg, "prebuilds", d), { recursive: true });
  writeFileSync(join(pkg, "package.json"), '{"name":"hashish","main":"index.js"}');
  writeFileSync(join(pkg, "binding.gyp"), "{}");
  writeFileSync(join(pkg, "index.js"), 'module.exports = require("node-gyp-build")(__dirname);');
  writeFileSync(join(pkg, "prebuilds/darwin-x64+arm64/hashish.node"), FAT);
  writeFileSync(join(pkg, "prebuilds/linux-x64/hashish.musl.node"), ELF_X64);
  writeFileSync(join(pkg, "prebuilds/linux-x64/hashish.glibc.node"), ELF_X64);
  writeFileSync(join(pkg, "prebuilds/linux-x64/hashish.electron.node"), ELF_X64);
  writeFileSync(join(pkg, "prebuilds/android-arm64/hashish.node"), ELF_ARM64);
  mkdirSync(join(nm, "node-gyp-build"));
  writeFileSync(join(nm, "node-gyp-build/package.json"), '{"name":"node-gyp-build","main":"index.js"}');
  writeFileSync(join(nm, "node-gyp-build/index.js"), 'module.exports = (d) => require(require("path").join(d, "nope.node"));');
  writeFileSync(join(dir, "server.js"), 'import h from "hashish";\nconsole.log(h);\n');
  return pkg;
}

test("node-gyp-build picks each target's prebuild: a universal darwin one, glibc over musl, never electron's", () => {
  const pkg = prebuilt(join(root, "gyp-pick"));
  expect(gypBuildFile(pkg, "darwin-arm64")).toBe(join(pkg, "prebuilds/darwin-x64+arm64/hashish.node"));
  expect(gypBuildFile(pkg, "darwin-x64")).toBe(join(pkg, "prebuilds/darwin-x64+arm64/hashish.node"));
  expect(gypBuildFile(pkg, "linux-x64")).toBe(join(pkg, "prebuilds/linux-x64/hashish.glibc.node"));
  expect(gypBuildFile(pkg, "linux-arm64")).toBeNull();          // android-arm64 is another OS
  expect(gypBuildFile(pkg, "windows-x64")).toBeNull();
  // The package's own build wins, for the target it's built for.
  mkdirSync(join(pkg, "build/Release"), { recursive: true });
  writeFileSync(join(pkg, "build/Release/hashish.node"), ELF_X64);
  expect(gypBuildFile(pkg, "linux-x64")).toBe(join(pkg, "build/Release/hashish.node"));
  expect(gypBuildFile(pkg, "darwin-arm64")).toBe(join(pkg, "prebuilds/darwin-x64+arm64/hashish.node"));
});

test("an addon found through node-gyp-build is carried for every target, and a target with none is named", async () => {
  const dir = join(root, "gyp");
  prebuilt(dir);
  const targets: DesktopOs[] = ["darwin-arm64", "darwin-x64", "linux-x64", "windows-x64"];
  const { addons, outdir } = await bundle(dir, targets);
  expect(addons.missed).toEqual([]);
  expect(addons.carried).toHaveLength(2);                      // the universal darwin one, linux's glibc one
  expect(addons.perTarget).toEqual([{ pkg: "hashish", files: expect.any(Array), missing: ["windows-x64"] }]);
  const js = readFileSync(join(outdir, "server-0.js"), "utf8");
  for (const f of addons.carried) expect(js).toContain(f);
  expect(js).toContain('"darwin-arm64"');
  expect(js).toContain('"linux-x64"');
  const err = addonProblems("server.js", addons, targets)!;
  expect(err).toContain("hashish has no addon for windows-x64");
  expect(err).not.toContain("is built for");                   // each target's file loads on it
  expect(addonProblems("server.js", addons, ["darwin-arm64", "linux-x64"])).toBeNull();
});

// napi-rs packages ship a build per OS, each its own package; the server loads the one for where it runs.
test("an addon with a prebuilt per OS needs one build per target, not every build on every target", () => {
  const dir = join(root, "per-os", "node_modules/@node-rs");
  mkdirSync(join(dir, "bcrypt-darwin-arm64"), { recursive: true });
  mkdirSync(join(dir, "bcrypt-linux-x64-gnu"), { recursive: true });
  const mac = join(dir, "bcrypt-darwin-arm64/bcrypt.darwin-arm64.node"), linux = join(dir, "bcrypt-linux-x64-gnu/bcrypt.linux-x64-gnu.node");
  writeFileSync(mac, MACHO_ARM64);
  writeFileSync(linux, ELF_X64);
  expect([mac, linux].map(addonName)).toEqual(["bcrypt", "bcrypt"]);
  const addons = { carried: [], sources: [mac, linux], perTarget: [], missed: [] };
  expect(addonProblems("server.js", addons, ["darwin-arm64", "linux-x64"])).toBeNull();
  const err = addonProblems("server.js", addons, ["linux-x64", "windows-x64"])!;
  expect(err).toContain("bcrypt.node is built for darwin-arm64, linux-x64, so it won't load on windows-x64");
});
