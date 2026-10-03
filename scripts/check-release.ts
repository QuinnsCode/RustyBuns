// Run before publish:all. bun publish rewrites workspace:* from bun.lock, not
// from each package.json, so a version bump without `bun install` publishes
// packages that depend on the previous release (0.1.6 shipped that way).
import { readFileSync } from "node:fs";

const PKGS = ["ports", "shell-bun", "native", "cli"];
const lock = readFileSync("bun.lock", "utf8");
const bad: string[] = [];
const versions = new Set<string>();
for (const p of PKGS) {
  const want = JSON.parse(readFileSync(`packages/${p}/package.json`, "utf8")).version as string;
  versions.add(want);
  const got = lock.match(new RegExp(`"packages/${p}": \\{[^}]*?"version": "([^"]+)"`))?.[1];
  if (got !== want) bad.push(`${p}: package.json ${want}, bun.lock ${got ?? "missing"}`);
}
if (versions.size > 1) bad.push(`packages disagree on version: ${[...versions].join(", ")}`);
if (bad.length) {
  console.error(`release check failed (run bun install and commit bun.lock):\n  ${bad.join("\n  ")}`);
  process.exit(1);
}
console.log(`release check ok: ${[...versions][0]}`);
