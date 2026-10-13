// desktop.server's native addons: the ones its bundle carries, the ones it can't, and which OS
// each carried one loads on.
import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addonLookups, addonName, addonPlatforms, addonProblems, copyTrees, gypBuildFile, prebuildUrl, serverAddons, type TargetLookup } from "../src/addons.ts";
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
  const err = addonProblems("../api/server.js", addons, outdir, ["linux-x64"])!;
  expect(err).toContain("desktop.server ../api/server.js: native addons the binary can't run");
  expect(err).toContain("@db/sqlish loads a native addon");
  expect(err).not.toContain("fast");                         // linux-x64 is what it's built for
});

test("a carried addon built for another OS names the targets it won't load on", async () => {
  const dir = join(root, "cross");
  fixture(dir, MACHO_ARM64, false);
  const { addons, outdir } = await bundle(dir);
  expect(addons.missed).toEqual([]);
  expect(addonProblems("server.js", addons, outdir, ["darwin-arm64"])).toBeNull();
  expect(addonProblems("server.js", addons, outdir, null)).toBeNull();      // the dev host: this machine
  const err = addonProblems("server.js", addons, outdir, ["darwin-arm64", "linux-x64", "windows-x64"])!;
  expect(err).toContain("fast.node is built for darwin-arm64, so it won't load on linux-x64, windows-x64");
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
  expect(addonProblems("server.js", addons, outdir, ["linux-x64"])).toBeNull();
  expect(addonProblems("server.js", addons, outdir, ["darwin-arm64"])).toContain("sqlite_ish.node is built for linux-x64");
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
  const err = addonProblems("server.js", addons, outdir, targets)!;
  expect(err).toContain("hashish has no addon for windows-x64");
  expect(err).not.toContain("is built for");                   // each target's file loads on it
  expect(addonProblems("server.js", addons, outdir, ["darwin-arm64", "linux-x64"])).toBeNull();
});

// napi-rs packages ship a build per OS, each its own package; the server loads the one for where it runs.
test("an addon with a prebuilt per OS needs one build per target, not every build on every target", () => {
  const dir = join(root, "per-os");
  mkdirSync(dir, { recursive: true });
  const mac = "server-0-bcrypt.darwin-arm64-bk1yghyr.node", linux = "server-0-bcrypt.linux-x64-gnu-ge3w5gb0.node";
  writeFileSync(join(dir, mac), MACHO_ARM64);
  writeFileSync(join(dir, linux), ELF_X64);
  expect([mac, linux].map(addonName)).toEqual(["bcrypt", "bcrypt"]);
  expect(addonProblems("server.js", { carried: [mac, linux], sources: [], perTarget: [], missed: [] }, dir, ["darwin-arm64", "linux-x64"])).toBeNull();
  const err = addonProblems("server.js", { carried: [mac, linux], sources: [], perTarget: [], missed: [] }, dir, ["linux-x64", "windows-x64"])!;
  expect(err).toContain("bcrypt.node is built for darwin-arm64, linux-x64, so it won't load on windows-x64");
});

// A registry and release host for the fetches below: tarballs by path, and the paths asked for.
function tarballServer(files: Record<string, Record<string, Uint8Array>>) {
  const asked: string[] = [], dir = join(root, "served-" + Object.keys(files).length + "-" + Math.random().toString(36).slice(2));
  const tgz: Record<string, Uint8Array> = {};
  for (const [path, entries] of Object.entries(files)) {
    const src = join(dir, path.replace(/\W/g, "_"));
    for (const [f, b] of Object.entries(entries)) { mkdirSync(join(src, f, ".."), { recursive: true }); writeFileSync(join(src, f), b); }
    expect(Bun.spawnSync(["tar", "-czf", src + ".tgz", "-C", src, ...Object.keys(entries)]).exitCode).toBe(0);
    tgz[path] = readFileSync(src + ".tgz");
  }
  const server = Bun.serve({ port: 0, fetch(req) {
    const p = new URL(req.url).pathname;
    asked.push(p);
    return tgz[p] ? new Response(tgz[p] as Uint8Array<ArrayBuffer>) : new Response("not found", { status: 404 });
  } });
  return { url: `http://127.0.0.1:${server.port}`, asked, stop: () => server.stop(true) };
}

async function withEnv<T>(vars: Record<string, string>, f: () => Promise<T>): Promise<T> {
  const was = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await f(); } finally { for (const [k, v] of Object.entries(was)) v === undefined ? delete process.env[k] : process.env[k] = v; }
}

// sharp's shape: lib/sharp.js requires `@img/sharp-${platform}/sharp.node`, a name it works out at
// run time; npm installed only this machine's @img packages.
function sharpish(dir: string) {
  const nm = join(dir, "node_modules");
  mkdirSync(join(nm, "sharp/lib"), { recursive: true });
  writeFileSync(join(nm, "sharp/package.json"), JSON.stringify({ name: "sharp", version: "0.34.5", main: "lib/index.js", optionalDependencies: {
    "@img/sharp-darwin-arm64": "0.34.5", "@img/sharp-libvips-darwin-arm64": "1.2.4",
    "@img/sharp-linux-x64": "0.34.5", "@img/sharp-libvips-linux-x64": "1.2.4", "@img/sharp-win32-x64": "0.34.5" } }));
  writeFileSync(join(nm, "sharp/binding.gyp"), "{}");
  writeFileSync(join(nm, "sharp/lib/index.js"), 'module.exports = require("./sharp.js");');
  writeFileSync(join(nm, "sharp/lib/sharp.js"), 'const p = process.platform + "-" + process.arch;\nmodule.exports = require(`@img/sharp-${p}/sharp.node`);');
  mkdirSync(join(nm, "@img/sharp-darwin-arm64/lib"), { recursive: true });
  writeFileSync(join(nm, "@img/sharp-darwin-arm64/package.json"), '{"name":"@img/sharp-darwin-arm64","version":"0.34.5"}');
  writeFileSync(join(nm, "@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node"), MACHO_ARM64);
  mkdirSync(join(nm, "@img/sharp-libvips-darwin-arm64/lib/glib-2.0"), { recursive: true });
  writeFileSync(join(nm, "@img/sharp-libvips-darwin-arm64/package.json"), '{"name":"@img/sharp-libvips-darwin-arm64","version":"1.2.4"}');
  writeFileSync(join(nm, "@img/sharp-libvips-darwin-arm64/lib/index.js"), "module.exports = __dirname;");
  writeFileSync(join(nm, "@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.3.dylib"), MACHO_ARM64);
  writeFileSync(join(dir, "server.js"), 'import sharp from "sharp";\nconsole.log(sharp);\n');
}

test("sharp's addon and libvips go in a tree per target, the ones npm skipped fetched from the registry", async () => {
  const dir = join(root, "sharp"), cache = join(dir, "cache");
  sharpish(dir);
  const reg = tarballServer({
    "/@img/sharp-linux-x64/-/sharp-linux-x64-0.34.5.tgz": { "package/package.json": new TextEncoder().encode("{}"), "package/lib/sharp-linux-x64.node": ELF_X64 },
    "/@img/sharp-libvips-linux-x64/-/sharp-libvips-linux-x64-1.2.4.tgz": { "package/lib/libvips-cpp.so.8.17.3": ELF_X64, "package/lib/index.js": new Uint8Array(1) },
  });
  const targets: DesktopOs[] = ["darwin-arm64", "linux-x64", "windows-x64"];
  try {
    const build = () => withEnv({ npm_config_registry: reg.url }, async () => {
      const outdir = join(dir, "out"), perTarget: TargetLookup[] = [];
      const r = await Bun.build({ entrypoints: [join(dir, "server.js")], outdir, naming: { entry: "server-0.[ext]", asset: "server-0-[name]-[hash].[ext]" }, target: "bun", metafile: true, plugins: [addonLookups(targets, perTarget, { tree: "server-0-native", cache })], throw: false } as any);
      expect(r.success).toBe(true);
      return { addons: serverAddons(r as any, perTarget), outdir, perTarget };
    });
    const { addons, outdir, perTarget } = await build();
    expect(addons.missed).toEqual([]);                         // sharp's binding.gyp is its lookup's
    expect(perTarget).toEqual([expect.objectContaining({ pkg: "sharp", missing: ["windows-x64"] })]);
    expect(copyTrees(outdir, "server-0-native", perTarget).sort()).toEqual([
      "server-0-native/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node",
      "server-0-native/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.3.dylib",
      "server-0-native/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.17.3",
      "server-0-native/@img/sharp-linux-x64/lib/sharp-linux-x64.node",
    ]);
    const js = readFileSync(join(outdir, "server-0.js"), "utf8");
    expect(js).toContain('"linux-x64": "server-0-native/@img/sharp-linux-x64/lib/sharp-linux-x64.node"');
    expect(js).toContain("import.meta.dir");
    expect(js).not.toContain("@img/sharp-${p}");               // sharp's own loader is gone
    const err = addonProblems("server.js", addons, outdir, targets)!;
    expect(err).toContain("sharp has no addon for windows-x64 (no @img/sharp-<os>-<arch> installed, or on the npm registry");
    expect(addonProblems("server.js", addons, outdir, ["darwin-arm64", "linux-x64"])).toBeNull();
    // A second build reads the cache; only the target with nothing to fetch asks again.
    const asked = reg.asked.length;
    await build();
    expect(reg.asked.slice(asked)).toEqual(["/@img/sharp-win32-x64/-/sharp-win32-x64-0.34.5.tgz"]);
  } finally { reg.stop(); }
});

// better-sqlite3's shape: bindings, with prebuild-install having fetched this machine's file only.
test("a prebuild-install package gets each other target's prebuild from its release, by prebuild-install's URL", async () => {
  const dir = join(root, "prebuild"), nm = join(dir, "node_modules"), abi = process.versions.modules;
  mkdirSync(join(nm, "sqlite-ish/build/Release"), { recursive: true });
  writeFileSync(join(nm, "sqlite-ish/package.json"), JSON.stringify({ name: "sqlite-ish", version: "1.2.3", main: "index.js",
    repository: { type: "git", url: "git+https://github.com/acme/sqlite-ish.git" }, dependencies: { bindings: "*", "prebuild-install": "*" } }));
  writeFileSync(join(nm, "sqlite-ish/index.js"), 'module.exports = (n) => require("bindings")(n);');
  writeFileSync(join(nm, "sqlite-ish/build/Release/sqlite_ish.node"), ELF_X64);
  mkdirSync(join(nm, "bindings"));
  writeFileSync(join(nm, "bindings/package.json"), '{"name":"bindings","main":"bindings.js"}');
  writeFileSync(join(nm, "bindings/bindings.js"), 'module.exports = (n) => require(require("path").join(process.cwd(), n));');
  writeFileSync(join(dir, "server.js"), 'import open from "sqlite-ish";\nexport { open };\n');
  expect(prebuildUrl(JSON.parse(readFileSync(join(nm, "sqlite-ish/package.json"), "utf8")), "windows-x64"))
    .toBe(`https://github.com/acme/sqlite-ish/releases/download/v1.2.3/sqlite-ish-v1.2.3-node-v${abi}-win32-x64.tar.gz`);
  const rel = tarballServer({
    [`/v1.2.3/sqlite-ish-v1.2.3-node-v${abi}-darwin-arm64.tar.gz`]: { "build/Release/sqlite_ish.node": MACHO_ARM64 },
    [`/v1.2.3/sqlite-ish-v1.2.3-node-v${abi}-linux-arm64.tar.gz`]: { "build/Release/sqlite_ish.node": ELF_ARM64 },
  });
  const targets: DesktopOs[] = ["darwin-arm64", "linux-x64", "linux-arm64", "windows-x64"];
  try {
    await withEnv({ npm_config_sqlite_ish_binary_host_mirror: rel.url }, async () => {
      const outdir = join(dir, "out"), perTarget: TargetLookup[] = [];
      const r = await Bun.build({ entrypoints: [join(dir, "server.js")], outdir, naming: { entry: "server-0.[ext]", asset: "server-0-[name]-[hash].[ext]" }, target: "bun", metafile: true, plugins: [addonLookups(targets, perTarget, { cache: join(dir, "cache") })], throw: false } as any);
      expect(r.success).toBe(true);
      const addons = serverAddons(r as any, perTarget);
      // Fetched for Bun's ABI where the release has one; the installed (the installing Node's) only where it hasn't.
      expect(addons.carried).toHaveLength(3);
      expect(addons.sources.filter((f) => f.startsWith(join(dir, "cache")))).toHaveLength(2);
      expect(addons.sources).toContain(join(nm, "sqlite-ish/build/Release/sqlite_ish.node"));
      expect(perTarget).toEqual([expect.objectContaining({ pkg: "sqlite-ish", missing: ["windows-x64"] })]);
      const err = addonProblems("server.js", addons, outdir, targets)!;
      expect(err).toContain(`sqlite-ish has no addon for windows-x64 (prebuild-install's release has none: ${rel.url}/v1.2.3/)`);
      expect(err).not.toContain("is built for");
      expect(addonProblems("server.js", addons, outdir, ["darwin-arm64", "linux-x64", "linux-arm64"])).toBeNull();
    });
  } finally { rel.stop(); }
});

test("prebuild-install -r napi asks for the newest N-API build Bun has", () => {
  const pkg = { name: "sqlite3", version: "5.1.7", repository: "github:TryGhost/node-sqlite3", binary: { napi_versions: [3, 6, 999] }, scripts: { install: "prebuild-install -r napi || node-gyp rebuild" } };
  expect(prebuildUrl(pkg, "linux-arm64")).toBe("https://github.com/TryGhost/node-sqlite3/releases/download/v5.1.7/sqlite3-v5.1.7-napi-v6-linux-arm64.tar.gz");
});

// better-sqlite3 13's shape: its own lib/binding.js joins prebuilds/<os>-<arch>.node.
test("better-sqlite3's own loader gets each target's prebuild by a static path", async () => {
  const dir = join(root, "bs13"), pkg = join(dir, "node_modules/better-sqlite3");
  mkdirSync(join(pkg, "prebuilds"), { recursive: true });
  mkdirSync(join(pkg, "lib"));
  writeFileSync(join(pkg, "package.json"), '{"name":"better-sqlite3","version":"13.0.0","main":"lib/index.js"}');
  writeFileSync(join(pkg, "binding.gyp"), "{}");
  writeFileSync(join(pkg, "lib/index.js"), 'module.exports = require("./binding").getBinding;');
  writeFileSync(join(pkg, "lib/binding.js"), 'const path = require("path");\nfunction getPrebuildPath() { return path.join(__dirname, "..", "prebuilds", process.platform + "-" + process.arch + ".node"); }\nexports.getBinding = () => require(getPrebuildPath());\nexports.getPrebuildPath = getPrebuildPath;');
  writeFileSync(join(pkg, "prebuilds/darwin-arm64.node"), MACHO_ARM64);
  writeFileSync(join(pkg, "prebuilds/linux-x64.node"), ELF_X64);
  writeFileSync(join(pkg, "prebuilds/linuxmusl-x64.node"), ELF_X64);
  writeFileSync(join(dir, "server.js"), 'import getBinding from "better-sqlite3";\nexport { getBinding };\n');
  const targets: DesktopOs[] = ["darwin-arm64", "linux-x64", "windows-x64"];
  const { addons, outdir } = await bundle(dir, targets);
  expect(addons.missed).toEqual([]);
  expect(addons.carried).toHaveLength(2);
  expect(addons.perTarget).toEqual([expect.objectContaining({ pkg: "better-sqlite3", missing: ["windows-x64"] })]);
  expect(addonProblems("server.js", addons, outdir, targets)).toContain("better-sqlite3 has no addon for windows-x64");
  expect(addonProblems("server.js", addons, outdir, ["darwin-arm64", "linux-x64"])).toBeNull();
  // A binding passed in is still used as is, without loading the carried one.
  const { getBinding } = await import(join(outdir, "server-0.js"));
  expect(getBinding({ mine: true })).toEqual({ mine: true });
});
