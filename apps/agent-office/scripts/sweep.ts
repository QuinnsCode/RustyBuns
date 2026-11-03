// 🧹 What sent-home workers leave on disk (#3325), by rules in live/sweep.ts. A dry run unless --go.
//
//   bun run office:sweep                         what it would free, GB per item
//   bun run office:sweep -- --go                 free it
//   bun run office:sweep -- --only=scratch,bun   just those (scratch, bun, caches, worktrees)
//   bun run office:sweep -- --repo <dir> --keep <dir>
//
// Repos default to every ~/agent-office/<owner>/<repo> with an .agent-office folder. `--keep` adds checkouts whose
// bun.lock the Bun cache must keep (your own clones elsewhere; a missed one only costs a download, nothing breaks).
// `worktrees` only lists: sending a worker home is the owner's call. ~/Downloads and anything else you made is never read.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { caches, duKb, gb, listTrees, pruneBunCache, sweepScratch } from "../live/sweep.ts";

const args = process.argv.slice(2);
const go = args.includes("--go");
const many = (flag: string) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [path.resolve(args[i + 1]!)] : []));
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const want = (part: string) => (only ? only.includes(part) : part !== "worktrees");

function officeRepos(): string[] {
  const root = path.join(homedir(), "agent-office");
  const out: string[] = [];
  for (const owner of existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []) {
    if (!owner.isDirectory()) continue;
    for (const repo of readdirSync(path.join(root, owner.name), { withFileTypes: true }))
      if (repo.isDirectory() && existsSync(path.join(root, owner.name, repo.name, ".agent-office"))) out.push(path.join(root, owner.name, repo.name));
  }
  return out;
}

const repos = many("--repo").length ? many("--repo") : officeRepos();
const verb = go ? "freed" : "would free";
let total = 0;
console.log(`🧹 ${go ? "Sweeping" : "Dry run (--go to free it)"}; repos: ${repos.map((r) => r.replace(homedir(), "~")).join(", ") || "none"}`);

if (want("scratch")) {
  const r = await sweepScratch(repos, go);
  total += r.bytes;
  console.log(`scratch of gone worktrees: ${r.paths.length} folders, ${verb} ${gb(r.bytes)}`);
}

if (want("bun")) {
  const r = await pruneBunCache([...repos, ...many("--keep")], go);
  total += r.bytes;
  console.log(r.refused ? `bun cache: skipped, ${r.refused}` : `bun cache: ${r.paths.length} versions no bun.lock names (of ${r.locks} lockfiles), ${verb} ${gb(r.bytes)}`);
}

if (want("caches")) {
  for (const c of caches()) {
    if (!existsSync(c.dir)) continue;
    const before = ((await duKb([c.dir])).get(c.dir) ?? 0) * 1024;
    if (!c.clean) { console.log(`${c.name}: ${gb(before)}, report only (no command that is safe to run for it)`); continue; }
    if (!go) { total += before; console.log(`${c.name}: ${gb(before)}, \`${c.clean.join(" ")}\` would clear it`); continue; }
    if (!Bun.which(c.clean[0]!)) { console.log(`${c.name}: ${gb(before)}, ${c.clean[0]} isn't installed`); continue; }
    const code = await Bun.spawn(c.clean, { stdout: "ignore", stderr: "ignore" }).exited;
    const after = ((await duKb([c.dir])).get(c.dir) ?? 0) * 1024;
    total += Math.max(0, before - after);
    console.log(`${c.name}: \`${c.clean.join(" ")}\` ${code === 0 ? "" : `exited ${code}, `}freed ${gb(Math.max(0, before - after))}`);
  }
}

if (want("worktrees")) {
  for (const repo of repos) {
    const trees = await listTrees(repo);
    if (!trees.length) continue;
    console.log(`\n${repo.replace(homedir(), "~")}: ${trees.length} worktrees, ${gb(trees.reduce((n, t) => n + t.kb * 1024, 0))}`);
    for (const t of trees) {
      const safe = t.merged && t.clean && t.unpushed === 0;
      console.log(`  ${safe ? "send home" : "keep     "}  ${gb(t.kb * 1024).padStart(8)}  ${String(t.days).padStart(3)}d  ${path.basename(t.path).padEnd(16)} ${t.branch}${t.merged ? " merged" : ""}${t.clean ? "" : " dirty"}${t.unpushed ? ` ${t.unpushed} unpushed` : ""}`);
    }
  }
}

console.log(`🧹 ${go ? "Freed" : "Would free"} ${gb(total)} in all`);
