// Shadow mode (#1014): codeSplitter's line-id merge run beside git's on PRs
// that already merged, from local git history alone. Each merge a PR made is
// replayed with the versions git saw: its squash onto main (main just before
// it, the PR's head) and each time the branch took main in on the way, each
// from the two sides' merge base. Every file both sides changed goes through
// `git merge-file` and through `merge()` + `lintMerge()` as a branch merge
// does (src/branches.ts), and each disagreement is printed:
//
//   git-only  git conflicts, codeSplitter merges clean
//   ours-only codeSplitter conflicts, git merges clean: a resolver gap, like
//             the ones measured in docs/merge-solutions.md
//   differ    both clean, different text
//   guard     a guard tripped: markers, data that won't parse, lint
//   lock      a lockfile both changed: a conflict by design (keep a side,
//             regenerate), so listed but not a gap
//   both      both conflict (agree: the same clean text, not listed)
//
// Each clean result is also checked against what landed on main: the PR's own
// resolution, which a person or agent made and CI passed.
//
//   bun scripts/shadow.ts [--limit 1000] [--pr 893,886] [--json]
//
// The PR list (number, head, merge commit) comes from `gh pr list`, read only;
// `--from prs.json` reads the same fields from a file instead. A PR whose head
// isn't in the local clone is skipped and counted. Each disagreement becomes a
// fixture in test/conflicts.test.ts or a fix issue.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, empty, fromText, merge, text, type Conflict, type Doc } from "../src/lines.ts";
import { diffToOps } from "../src/sync.ts";
import { lintMerge } from "../src/lint.ts";
import { policyOf } from "../src/policy.ts";

export type Verdict = "agree" | "both" | "git-only" | "ours-only" | "differ" | "guard" | "lock";
export interface Shadow {
  verdict: Verdict;
  git: { clean: boolean; text: string };
  ours: { clean: boolean; text: string | null; conflicts: Conflict[] };
  /**
   * Whether each clean result is what landed on main (the PR's own resolution),
   * when that's known, how many lines of ours it changed (`off`), and whether
   * it only put ours's lines in another order (`reordered`: both sides' new
   * tests or rows, the other one first).
   */
  landed?: { git: boolean; ours: boolean; off: number; reordered: boolean };
}

/** Both merges of one file, from its three versions as text. */
export function shadow(path: string, base: string, main: string, branch: string, attributes = "", landed?: string): Shadow {
  const git = gitMerge(base, main, branch);
  const ours = lineMerge(path, base, main, branch, attributes);
  const guard = ours.conflicts.some((c) => c.lint);
  const verdict: Verdict = guard ? "guard"
    : ours.conflicts.length && ours.conflicts.every((c) => c.whole) ? "lock"
    : git.clean && !ours.clean ? "ours-only"
    : !git.clean && ours.clean ? "git-only"
    : git.clean && ours.clean && git.text !== ours.text ? "differ"
    : !git.clean && !ours.clean ? "both"
    : "agree";
  if (landed === undefined) return { verdict, git, ours };
  const o = ours.text;
  return { verdict, git, ours, landed: {
    git: git.clean && git.text === landed, ours: o === landed,
    off: o === null ? 0 : linesOff(o, landed), reordered: o !== null && o !== landed && sorted(o) === sorted(landed),
  } };
}

const sorted = (s: string) => s.split("\n").sort().join("\n");

/** How many lines a diff from `a` to `b` touches. */
function linesOff(a: string, b: string) {
  const d = empty();
  apply(d, fromText(a), "a");
  return diffToOps(d.lines, b.split("\n")).length;
}

/** codeSplitter's merge as a branch merge runs it: each side's text diffed to line ops on one base doc, then lint. */
export function lineMerge(path: string, base: string, main: string, branch: string, attributes = "") {
  const m = empty();
  apply(m, fromText(base), "base");
  const b = structuredClone(m), br = structuredClone(m);
  apply(m, diffToOps(m.lines, main.split("\n")), "main");
  apply(br, diffToOps(br.lines, branch.split("\n")), "branch");
  const r = merge(b, br, m, {}, "branch", path, "branch", policyOf(path, attributes).merge);
  const conflicts = [...r.conflicts];
  let out: string | null = null;
  if (!conflicts.length) {
    conflicts.push(...lintMerge(path, m, br, r));
    const d: Doc = structuredClone(m);
    if (apply(d, r.ops, r.by, 0, m.rev).ok) out = text(d);
    else conflicts.push({ line: "apply", base: "", main: null, branch: null, lint: "the merge's ops don't apply to main" });
  }
  return { clean: !conflicts.length, text: out, conflicts };
}

/** git's own three-way merge of one file's text. */
export function gitMerge(base: string, main: string, branch: string) {
  const dir = mkdtempSync(join(tmpdir(), "shadow-"));
  try {
    const [b, m, br] = ["base", "main", "branch"].map((n) => join(dir, n));
    writeFileSync(b!, base); writeFileSync(m!, main); writeFileSync(br!, branch);
    const r = Bun.spawnSync(["git", "merge-file", "-p", "--diff3", "-L", "main", "-L", "base", "-L", "branch", m!, b!, br!]);
    if (r.exitCode! < 0 || r.exitCode! > 127) throw new Error(`git merge-file: ${r.stderr.toString()}`);
    return { clean: r.exitCode === 0, text: r.stdout.toString() };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const git = (...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args]);
  return r.exitCode === 0 ? r.stdout.toString() : null;
};
const show = (rev: string, path: string) => git("show", `${rev}:${path}`);
// Changed or added: a file both sides added is a merge from an empty base.
const changed = (from: string, to: string) => new Set((git("diff", "--name-only", "--no-renames", "--diff-filter=AM", from, to) ?? "").split("\n").filter(Boolean));
const binary = (s: string) => s.includes("\0");

interface Pr { number: number; headRefOid: string; mergeCommit: { oid: string } | null }
/** One merge git made: the two sides it joined and what it committed. */
interface Join { label: string; main: string; branch: string; landed: string }

/**
 * A PR's merges: its squash onto main (main just before it, the PR's head), and
 * each time the branch took main in on the way (a merge commit in its range,
 * first parent the branch's), which is where most real conflicts were settled.
 */
function joins(pr: Pr): Join[] | null {
  const landed = pr.mergeCommit?.oid;
  const main = landed && git("rev-parse", "--verify", "-q", `${landed}^1`)?.trim();
  if (!landed || !main || git("cat-file", "-e", pr.headRefOid) === null) return null;
  const inner = (git("rev-list", "--merges", "--parents", `${main}..${pr.headRefOid}`) ?? "").split("\n").filter(Boolean).map((l) => l.split(" "));
  return [
    { label: `#${pr.number}`, main, branch: pr.headRefOid, landed },
    ...inner.map(([x, branch, main]) => ({ label: `#${pr.number} ${x!.slice(0, 7)}`, main: main!, branch: branch!, landed: x! })),
  ];
}

if (import.meta.main) {
  const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const only = arg("pr")?.split(",").map(Number);
  const from = arg("from");
  const prs: Pr[] = JSON.parse(from ? readFileSync(from, "utf8")
    : Bun.spawnSync(["gh", "pr", "list", "--state", "merged", "--limit", arg("limit") ?? "1000", "--json", "number,headRefOid,mergeCommit"]).stdout.toString() || "[]");
  const tally: Record<Verdict | "prs" | "skipped" | "merges" | "files", number> = { agree: 0, both: 0, "git-only": 0, "ours-only": 0, differ: 0, guard: 0, lock: 0, prs: 0, skipped: 0, merges: 0, files: 0 };
  const found: { label: string; path: string; s: Shadow }[] = [];
  for (const pr of prs) {
    if (only && !only.includes(pr.number)) continue;
    tally.prs++;
    const js = joins(pr);
    if (!js) { tally.skipped++; continue; }
    for (const j of js) {
      const base = git("merge-base", j.main, j.branch)?.trim();
      if (!base) continue;
      tally.merges++;
      const attributes = show(j.main, ".gitattributes") ?? "";
      const theirs = changed(base, j.branch);
      for (const path of changed(base, j.main)) {
        if (!theirs.has(path)) continue;
        const [b = "", m, br] = [show(base, path) ?? undefined, show(j.main, path), show(j.branch, path)];
        if (m == null || br == null || [b, m, br].some(binary) || m === br) continue;
        tally.files++;
        const s = shadow(path, b, m, br, attributes, show(j.landed, path) ?? undefined);
        tally[s.verdict]++;
        if (s.verdict !== "agree") found.push({ label: j.label, path, s });
      }
    }
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify({ tally, found }, null, 2));
  else {
    console.log(`${tally.merges} merges from ${tally.prs - tally.skipped} PRs (${tally.skipped} skipped: not in this clone), ${tally.files} files both sides changed`);
    console.log((["agree", "both", "git-only", "ours-only", "differ", "guard", "lock"] as const).map((k) => `${k} ${tally[k]}`).join(" · "));
    for (const { label, path, s } of found) {
      const why = s.ours.conflicts.map((c) => c.lint ? `${c.line}: ${c.lint}` : c.line).join(", ");
      const matched = s.landed && [s.landed.git && "git's", s.landed.ours && "ours"].filter(Boolean).join(" and ");
      const note = s.landed ? ` (landed: ${matched || "neither"}${s.ours.clean && !s.landed.ours ? `, ${s.landed.reordered ? "ours reordered" : `${s.landed.off} lines off ours`}` : ""})` : "";
      console.log(`${label} ${path}: ${s.verdict}${note}${why ? ` [${why}]` : ""}`);
    }
  }
}
