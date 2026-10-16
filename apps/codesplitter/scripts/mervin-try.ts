// Try Mervin on your repo's own history: give it a link (or a local clone) and it says how many of the
// conflicts your merges hit Mervin would have settled, and how many fights it would have seen coming.
//
//   bun scripts/mervin-try.ts <git url | path> [--limit 200] [--keep]
//
// A URL is cloned bare into a temp dir (no hooks run, nothing is checked out) and removed after, unless
// `--keep`. Nothing is written to a local path. It reads merge commits, so a repo that squash-merges every PR
// has none to replay: the report says so instead of showing zeros.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./mervin-corpus.ts";
import { score, tally } from "./mervin-score.ts";

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");

/** The plain-words report for a clone at `repo`. */
export function report(repo: string, limit = 200): string {
  const { merges, fought, rows } = run(repo, limit);
  const hit = rows.filter((r) => ["solved", "close", "wrong", "cards", "guard", "lock"].includes(r.bucket));
  const n = (b: string) => rows.filter((r) => r.bucket === b).length;
  const seen = tally(score(repo, limit), "plan");
  const out: string[] = [];
  if (!merges) return "No merge commits in this history (squash or rebase merges leave nothing to replay), so there is nothing to score. Try a repo that merges with merge commits.";
  out.push(`${merges} merges read, ${fought} of them conflicted in git (${hit.length} files).`);
  // A merge is off the bottleneck when every file git stopped on is one Mervin settles: nobody had to stop and resolve it.
  const byMerge = new Map<string, boolean>();
  for (const r of hit) byMerge.set(r.merge, (byMerge.get(r.merge) ?? true) && (r.bucket === "solved" || r.bucket === "close"));
  const free = [...byMerge.values()].filter(Boolean).length;
  if (byMerge.size) out.push(`${free} of those ${byMerge.size} merges (${pct(free, byMerge.size)}) would have needed no person to stop and resolve: every conflicted file settled on its own.`);
  if (hit.length) {
    out.push(`Mervin would have settled ${n("solved") + n("close")} of ${hit.length} (${pct(n("solved") + n("close"), hit.length)}): ${n("solved")} to exactly what you committed, ${n("close")} to the same lines reordered or reindented.`);
    out.push(`It would have asked about ${n("cards") + n("guard")} (${pct(n("cards") + n("guard"), hit.length)}) and left ${n("lock")} lockfile${n("lock") === 1 ? "" : "s"} to the package manager.`);
    out.push(`It would have settled ${n("wrong")} (${pct(n("wrong"), hit.length)}) to different text than you chose; some of those are you editing around the conflict, not mistakes.`);
  }
  if (seen.fought) out.push(`Of ${seen.fought} PRs that fought, ${seen.flagged ? pct(seen.recall * seen.fought, seen.fought) : "0%"} were flagged while still open, at ${pct(seen.precision * seen.flagged, seen.flagged)} precision.`);
  return out.join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const target = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--limit");
  if (!target) { console.error("usage: bun scripts/mervin-try.ts <git url | path> [--limit 200] [--keep]"); process.exit(2); }
  const limit = Number(args[args.indexOf("--limit") + 1]) || 200;
  const remote = /^(https?|git|ssh):\/\/|^git@/.test(target);
  const dir = remote ? mkdtempSync(join(tmpdir(), "mervin-try-")) : null;
  try {
    if (dir) {
      console.error(`Cloning ${target} ...`);
      const c = Bun.spawnSync(["git", "clone", "--bare", "--quiet", target, dir], { stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      if (c.exitCode !== 0) { console.error(`Could not clone: ${c.stderr.toString().trim()}`); process.exit(1); }
    }
    console.log(report(dir ?? target, limit));
    if (dir && args.includes("--keep")) console.error(`Kept the clone at ${dir}`);
  } finally { if (dir && !args.includes("--keep")) rmSync(dir, { recursive: true, force: true }); }
}
