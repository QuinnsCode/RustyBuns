// Run before publishing (npm-publish.yml runs it). bun pm pack rewrites workspace:* from bun.lock, not
// from each package.json, so a version bump without `bun install` publishes
// packages that depend on the previous release (0.1.6 shipped that way).
//
//   bun scripts/check-release.ts               check the packages, bun.lock and the README banner agree
//   bun scripts/check-release.ts --set 0.1.13  write that version into all three first, then check (#4528)
//   bun scripts/check-release.ts --list        the published packages, dependencies first
//
// `--set` is how a release ships the commit the stable ring soaked: npm-publish.yml takes the version from the `v` tag
// and sets it at pack time, so no bump commit has to land on top of main first. `--list` is the order npm-publish.yml
// packs and publishes in, and the names scripts/npm-claim.ts claims.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { obj, str } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";

const Versioned = obj({ version: str(100) });

export const PKGS = ["ports", "ui", "util", "game-controls", "models", "terrain", "rig", "seal", "cms", "shell-bun", "native", "cli"];

const lockEntry = (p: string) => new RegExp(`("packages/${p}": \\{[^}]*?"version": ")([^"]+)(")`);
const BANNER = /Alpha, `([^`]+)`/;

/** Writes `version` into every published package's package.json, its bun.lock workspace entry (what bun pm pack
 *  turns workspace:* into) and the README banner, under `root`. */
export function setVersion(version: string, root = "."): void {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not a plain x.y.z version: ${version}`);
  for (const p of PKGS) {
    const file = join(root, "packages", p, "package.json");
    const text = readFileSync(file, "utf8");
    Versioned(JSON.parse(text));
    writeFileSync(file, text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
  }
  const lockFile = join(root, "bun.lock");
  let lock = readFileSync(lockFile, "utf8");
  for (const p of PKGS) {
    if (!lockEntry(p).test(lock)) throw new Error(`bun.lock has no workspace entry for packages/${p}`);
    lock = lock.replace(lockEntry(p), `$1${version}$3`);
  }
  writeFileSync(lockFile, lock);
  const readme = join(root, "README.md");
  writeFileSync(readme, readFileSync(readme, "utf8").replace(BANNER, `Alpha, \`${version}\``));
}

/** What disagrees: each package.json against its bun.lock entry, the packages against each other, the README banner. */
export function checkRelease(root = "."): { version?: string; bad: string[] } {
  const lock = readFileSync(join(root, "bun.lock"), "utf8");
  const bad: string[] = [];
  const versions = new Set<string>();
  for (const p of PKGS) {
    const want = Versioned(JSON.parse(readFileSync(join(root, "packages", p, "package.json"), "utf8"))).version;
    versions.add(want);
    const got = lock.match(lockEntry(p))?.[2];
    if (got !== want) bad.push(`${p}: package.json ${want}, bun.lock ${got ?? "missing"}`);
  }
  if (versions.size > 1) bad.push(`packages disagree on version: ${[...versions].join(", ")}`);
  // The README banner names the release ("Alpha, `0.1.9`."), and was left behind once.
  const banner = readFileSync(join(root, "README.md"), "utf8").match(BANNER)?.[1];
  const version = versions.size === 1 ? [...versions][0] : undefined;
  if (version && banner !== version) bad.push(`README.md says ${banner ?? "no version"}, packages are ${version}`);
  return { version, bad };
}

if (import.meta.main) {
  help(import.meta.path);
  const args = process.argv.slice(2);
  if (args.includes("--list")) { console.log(PKGS.join(" ")); process.exit(0); }
  const set = args.indexOf("--set");
  if (set >= 0) setVersion(args[set + 1] ?? "");
  const { version, bad } = checkRelease();
  if (bad.length) {
    console.error(`release check failed (run bun install and commit bun.lock; update the README banner):\n  ${bad.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`release check ok: ${version}`);
}
