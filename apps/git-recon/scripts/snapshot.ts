// Snapshots a git repo's tracked source files (path and line count) into
// src/levels/repos/<name>.json, which a level maps onto its ground.
//
//   bun scripts/snapshot.ts <repo-dir> <name> [max-files]
//
// Only what git tracks at HEAD, only source-ish text, the biggest files first. Alongside them,
// what src/sim/intel.ts works out: which folders import which, and the last hundred commits'
// churn per file and how much of it agents did. src/levels/github.ts does the same for a live repo.

import { resolve } from "node:path";
import { folderOf } from "../src/sim/codemap.ts";
import { folderLinks, isAgentCommit, isScript, MAX_FILES, SKIP, SOURCE, tally, workspacePackages } from "../src/sim/intel.ts";

const [dir, name, max = String(MAX_FILES)] = process.argv.slice(2);
if (!dir || !name) {
  console.error("usage: bun scripts/snapshot.ts <repo-dir> <name> [max-files]");
  process.exit(1);
}
const repo = resolve(dir);
/** Commits looked back through for churn. */
const RECENT = 100;

const ref = (await Bun.$`git -C ${repo} rev-parse --short HEAD`.text()).trim();
const files: { path: string; lines: number }[] = [];
const sources: { path: string; text: string }[] = [];
const all = (await Bun.$`git -C ${repo} ls-files`.text()).split("\n").filter(Boolean);
const paths = all.filter((p) => SOURCE.test(p) && !SKIP.test(p));
const manifests = await Promise.all(all.filter((p) => /(^|\/)package\.json$/.test(p) && !SKIP.test(p)).map(async (path) => ({ path, text: await Bun.file(`${repo}/${path}`).text().catch(() => "") })));
for (const path of paths) {
  const text = await Bun.file(`${repo}/${path}`).text().catch(() => "");
  const lines = text ? text.split("\n").length : 0;
  if (lines > 0) files.push({ path, lines });
  if (text && isScript(path)) sources.push({ path, text });
}
files.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));

// Each commit as "\x01<author>\x02<message>\x03" then the paths it touched.
const log = await Bun.$`git -C ${repo} log -n ${RECENT} --name-only --format=%x01%an%x02%B%x03`.text();
const commits = log.split("\x01").filter(Boolean).map((c) => {
  const [author = "", rest = ""] = c.split("\x02"), [message = "", touched = ""] = rest.split("\x03");
  return { agent: isAgentCommit(message, author), paths: touched.split("\n").filter(Boolean) };
});

const kept = tally(files.slice(0, Number(max)), commits).sort((a, b) => a.path.localeCompare(b.path));
const out = resolve(import.meta.dir, `../src/levels/repos/${name}.json`);
await Bun.write(out, JSON.stringify({ name, ref, files: kept, links: folderLinks(sources, workspacePackages(manifests), new Set(files.map((f) => folderOf(f.path)))) }) + "\n");
console.log(`${name}@${ref}: ${kept.length} of ${files.length} files, ${commits.length} commits -> ${out}`);
