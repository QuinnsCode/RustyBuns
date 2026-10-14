// Mervin scorecard: how often did a PR that fought at merge time get flagged halfway through its life?
//
//   bun scripts/mervin-score.ts [repo ...] [--limit 200] [--json]
//
// For each two-parent merge of a branch into the mainline (not "merge main into the branch"), the truth is
// git's merge of the two parents (`merge-tree --write-tree`): conflicted means the PR fought. The predictors
// only see the branch's midpoint commit and the mainline as of that commit's date:
//   overlap  the branch and the mainline have both touched a file since the base
//   clash    git's merge of those two midpoints already conflicts
//   lines    the line-id merge (src/lines.ts, as a branch merge runs it) of those two midpoints leaves cards
//            on a file both touched
// Recall is the share of fights flagged ahead; precision is the share of flags that fought. The 80% goal is
// recall on fights, with precision kept honest. Repos with no real merge commits (squash-only) score nothing.

import { lineMerge } from "./shadow.ts";

const git = (repo: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd: repo, stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() };
};
const names = (repo: string, a: string, b: string) => new Set(git(repo, "diff", "--name-only", "--no-renames", a, b).out.split("\n").filter(Boolean));
const show = (repo: string, rev: string, path: string) => {
  const r = Bun.spawnSync(["git", "show", `${rev}:${path}`], { cwd: repo, stderr: "pipe", maxBuffer: 64 << 20 });
  return r.exitCode === 0 ? r.stdout.toString() : null;
};
/** Does the line-id merge leave cards on any file both sides touched? A delete against an edit always does. */
function linesClash(repo: string, base: string, mid: string, mainThen: string, files: string[]) {
  for (const path of files) {
    const [b, br, m] = [show(repo, base, path), show(repo, mid, path), show(repo, mainThen, path)];
    if (br === null || m === null) { if (br !== m) return true; continue; }
    if (br === m || b?.includes("\0") || br.includes("\0") || m.includes("\0")) continue;
    if (!lineMerge(path, b ?? "", m, br).clean) return true;
  }
  return false;
}
const fights = (repo: string, a: string, b: string) => git(repo, "merge-tree", "--write-tree", "--no-messages", a, b).code === 1;

export interface Case { commit: string; fought: boolean; overlap: boolean; clash: boolean; lines: boolean }

export function score(repo: string, limit = 200): Case[] {
  const log = git(repo, "log", "--merges", "--first-parent", `-n${limit * 3}`, "--format=%H %P|%s").out.split("\n").filter(Boolean);
  const cases: Case[] = [];
  for (const line of log) {
    if (cases.length >= limit) break;
    const [head, subject] = line.split("|");
    const [commit, main, branch, ...rest] = head.split(" ");
    if (!branch || rest.length || /^Merge (remote-tracking )?branch '?(main|master|develop)\b/.test(subject)) continue;
    const base = git(repo, "merge-base", main, branch).out.trim();
    if (!base) continue;
    const own = git(repo, "rev-list", "--reverse", `${base}..${branch}`).out.split("\n").filter(Boolean);
    if (own.length < 2) continue; // no midpoint to predict from
    const mid = own[Math.floor(own.length / 2) - 1];
    const when = git(repo, "log", "-1", "--format=%cI", mid).out.trim();
    const mainThen = git(repo, "rev-list", "-1", "--first-parent", `--before=${when}`, main).out.trim();
    if (!mainThen) continue;
    const baseNow = git(repo, "merge-base", mainThen, mid).out.trim() || base;
    const mine = names(repo, baseNow, mid), theirs = names(repo, baseNow, mainThen);
    const both = [...mine].filter((f) => theirs.has(f));
    cases.push({
      commit: commit.slice(0, 7),
      fought: fights(repo, main, branch),
      overlap: both.length > 0,
      clash: fights(repo, mainThen, mid),
      lines: linesClash(repo, baseNow, mid, mainThen, both),
    });
  }
  return cases;
}

export function tally(cases: Case[], by: "overlap" | "clash" | "lines") {
  const fought = cases.filter((c) => c.fought).length, flagged = cases.filter((c) => c[by]).length;
  const hit = cases.filter((c) => c.fought && c[by]).length;
  return { prs: cases.length, fought, flagged, recall: fought ? hit / fought : NaN, precision: flagged ? hit / flagged : NaN };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const limit = Number(args[args.indexOf("--limit") + 1]) || 200;
  const repos = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--limit");
  const pct = (x: number) => (Number.isNaN(x) ? "n/a" : `${Math.round(x * 100)}%`);
  const all: Record<string, unknown> = {};
  for (const repo of repos.length ? repos : ["."]) {
    const cases = score(repo, limit);
    all[repo] = { overlap: tally(cases, "overlap"), clash: tally(cases, "clash"), lines: tally(cases, "lines") };
    if (args.includes("--json")) continue;
    console.log(`${repo}: ${cases.length} merged PRs, ${cases.filter((c) => c.fought).length} fought`);
    for (const by of ["overlap", "clash", "lines"] as const) {
      const t = tally(cases, by);
      console.log(`  ${by.padEnd(8)} flagged ${t.flagged}, recall ${pct(t.recall)}, precision ${pct(t.precision)}`);
    }
  }
  if (args.includes("--json")) console.log(JSON.stringify(all, null, 2));
}
