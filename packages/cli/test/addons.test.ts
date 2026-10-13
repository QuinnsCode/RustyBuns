// desktop.server's native addons: the ones its bundle carries, the ones it can't, and which OS
// each carried one loads on.
import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { addonName, addonPlatforms, addonProblems, serverAddons } from "../src/addons.ts";

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

async function bundle(dir: string) {
  const outdir = join(dir, "out");
  const r = await Bun.build({ entrypoints: [join(dir, "server.js")], outdir, naming: { entry: "server-0.[ext]", asset: "server-0-[name]-[hash].[ext]" }, target: "bun", metafile: true, throw: false } as any);
  expect(r.success).toBe(true);
  return { addons: serverAddons(r as any), outdir };
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
  expect(err).toMatch(/fast\.node is built for darwin-arm64, so it won't load on linux-x64, windows-x64/);
});

// napi-rs packages ship a build per OS, each its own package; the server loads the one for where it runs.
test("an addon with a prebuilt per OS needs one build per target, not every build on every target", () => {
  const dir = join(root, "per-os");
  mkdirSync(dir, { recursive: true });
  const mac = "server-0-bcrypt.darwin-arm64-bk1yghyr.node", linux = "server-0-bcrypt.linux-x64-gnu-ge3w5gb0.node";
  writeFileSync(join(dir, mac), MACHO_ARM64);
  writeFileSync(join(dir, linux), ELF_X64);
  expect([mac, linux].map(addonName)).toEqual(["bcrypt", "bcrypt"]);
  expect(addonProblems("server.js", { carried: [mac, linux], missed: [] }, dir, ["darwin-arm64", "linux-x64"])).toBeNull();
  const err = addonProblems("server.js", { carried: [mac, linux], missed: [] }, dir, ["linux-x64", "windows-x64"])!;
  expect(err).toContain("bcrypt.node is built for darwin-arm64, linux-x64, so it won't load on windows-x64");
});
