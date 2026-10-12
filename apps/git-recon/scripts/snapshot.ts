// Snapshots a git repo's tracked source files (path and line count) into
// src/levels/repos/<name>.json, which a level maps onto its ground.
//
//   bun scripts/snapshot.ts <repo-dir> <name> [max-files]
//
// Only what git tracks at HEAD, only source-ish text, the biggest files first.

import { resolve } from "node:path";

const [dir, name, max = "360"] = process.argv.slice(2);
if (!dir || !name) {
  console.error("usage: bun scripts/snapshot.ts <repo-dir> <name> [max-files]");
  process.exit(1);
}
const repo = resolve(dir);
const SOURCE = /\.(ts|tsx|js|jsx|mjs|rs|go|py|rb|swift|kt|java|c|h|cc|cpp|css|html|md|toml|ya?ml|sh)$/;
const SKIP = /(^|\/)(node_modules|dist|vendor|fixtures?|\.github)\/|\.min\.|lock/;

const ref = (await Bun.$`git -C ${repo} rev-parse --short HEAD`.text()).trim();
const paths = (await Bun.$`git -C ${repo} ls-files`.text()).split("\n").filter((p) => SOURCE.test(p) && !SKIP.test(p));
const files: { path: string; lines: number }[] = [];
for (const path of paths) {
  const text = await Bun.file(`${repo}/${path}`).text().catch(() => "");
  const lines = text ? text.split("\n").length : 0;
  if (lines > 0) files.push({ path, lines });
}
files.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
const kept = files.slice(0, Number(max)).sort((a, b) => a.path.localeCompare(b.path));
const out = resolve(import.meta.dir, `../src/levels/repos/${name}.json`);
await Bun.write(out, JSON.stringify({ name, ref, files: kept }) + "\n");
console.log(`${name}@${ref}: ${kept.length} of ${files.length} files -> ${out}`);
