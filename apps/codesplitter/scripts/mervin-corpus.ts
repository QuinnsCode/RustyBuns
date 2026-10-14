// Mervin on a big repo: what would the line-id merge have solved?
//
//   bun scripts/mervin-corpus.ts <repo> [--limit 300] [--max-lines 3000] [--json] [--show 10]
//
// scripts/mervin-score.ts asks whether a fight was seen coming. This asks the next question: once two
// branches did meet, how many of the files git gave up on does Mervin settle, and does it settle them the
// way the person who merged them by hand did? Every real two-parent merge of a branch into the mainline is
// replayed file by file (the files both sides changed since their merge base) through `shadow()`, the same
// git-beside-Mervin comparison scripts/shadow.ts runs on this repo's PRs, with the merge commit's copy as
// the truth.
//
//   solved    git conflicts, Mervin settles it to exactly what landed
//   close     git conflicts, Mervin settles it to the same lines in another order, or the same text bar indentation
//   wrong     git conflicts, Mervin settles it to other text: a silent bad merge, the number to drive to 0
//   cards     git conflicts, Mervin hands back cards (it asks instead of guessing)
//   gap       git merges clean, Mervin conflicts: a resolver gap
//   guard     a guard tripped (markers, unparseable data, lint)
//   agree     both clean (the common case, listed for scale)
//
// The repo may be bare and full (not shallow). Nothing is written to it.

import { shadow, type Verdict } from "./shadow.ts";

const GIT_BUF = 64 << 20;

export type Bucket = "solved" | "close" | "wrong" | "cards" | "gap" | "guard" | "lock" | "agree" | "differ";
/** One file's fate. `landed` is the merge commit's copy. */
export function bucket(verdict: Verdict, gitClean: boolean, oursClean: boolean, exact: boolean, near: boolean): Bucket {
  if (verdict === "guard") return "guard";
  if (verdict === "lock") return "lock";
  if (gitClean && !oursClean) return "gap";
  if (gitClean) return verdict === "differ" ? "differ" : "agree";
  if (!oursClean) return "cards";
  return exact ? "solved" : near ? "close" : "wrong";
}

/** A file with each line's leading and trailing space dropped: indentation is a style, not a different merge. */
const unindented = (t: string) => t.split("\n").map((l) => l.trim()).join("\n");

export interface Row { merge: string; path: string; ext: string; bucket: Bucket; off: number }

/** For the borg engine (scripts/borg-engine.ts): skip merges it has replayed, and see each file's three texts, what Mervin made of them, and what landed. */
export interface Hooks {
  skip?: (commit: string) => boolean;
  each?: (row: Row, texts: { base: string; main: string; branch: string; landed: string; ours: string | null }) => void;
  /** Called once per merge the walk took up, conflicted or not, after its files. */
  done?: (commit: string) => void;
}

/** The paths git's merge of two commits conflicts on (none when it merges clean). */
function conflicted(repo: string, main: string, branch: string): string[] {
  const r = Bun.spawnSync(["git", "-C", repo, "merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", main, branch], { stderr: "pipe", maxBuffer: GIT_BUF });
  if (r.exitCode !== 1) return [];
  const [, ...rest] = r.stdout.toString().split("\0");
  return [...new Set(rest.slice(0, Math.max(0, rest.indexOf(""))))];
}

/** Replays up to `limit` conflicted merges of `repo` (a clone, bare or not) and files each conflicted file's fate. */
export function run(repo: string, limit = 300, maxLines = 3000, hooks: Hooks = {}): { merges: number; fought: number; skipped: number; rows: Row[] } {
  const git = (...a: string[]) => {
    const r = Bun.spawnSync(["git", "-C", repo, ...a], { stderr: "pipe", maxBuffer: GIT_BUF });
    return r.exitCode === 0 ? r.stdout.toString() : null;
  };
  // Every two-parent merge, not just first-parent: a repo that merges only green PRs (bors, merge queues) never
  // has a conflicted merge into the mainline, so the hand-settled conflicts are in the "merge main into the
  // branch" commits. Merges git settles clean are skipped, they have nothing to solve.
  const log = (git("log", "--merges", `-n${limit * 40}`, "--format=%H %P") ?? "").split("\n").filter(Boolean);
  const rows: Row[] = [];
  let merges = 0, fought = 0, skipped = 0;
  for (const line of log) {
    if (fought >= limit) break;
    const [commit, main, branch, ...rest] = line.split(" ");
    if (!branch || rest.length || hooks.skip?.(commit!)) continue;
    merges++;
    const paths = conflicted(repo, main!, branch);
    if (!paths.length) { hooks.done?.(commit!); continue; }
    fought++;
    const base = git("merge-base", main!, branch)?.trim();
    for (const path of paths) {
      const [m, br, landed] = [main!, branch, commit!].map((rev) => git("show", `${rev}:${path}`));
      const b = base ? git("show", `${base}:${path}`) ?? "" : ""; // added on both sides: merge from empty
      if (m === null || br === null || landed === null) { skipped++; continue; } // deleted on a side: a modify/delete, not a text merge
      if (!git("ls-tree", commit!, "--", path)?.startsWith("100")) { skipped++; continue; } // a symlink or submodule: its text is a target, not code
      if ([b, m, br].some((t) => t.includes("\0") || t.split("\n").length > maxLines)) { skipped++; continue; }
      try {
        const s = shadow(path, b, m, br, "", landed);
        const row: Row = {
          merge: commit!.slice(0, 9), path, ext: path.match(/\.([\w]+)$/)?.[1] ?? "(none)",
          bucket: bucket(s.verdict, s.git.clean, s.ours.clean, s.landed!.ours, s.landed!.reordered || (s.ours.text !== null && unindented(s.ours.text) === unindented(landed))), off: s.landed!.off,
        };
        rows.push(row);
        hooks.each?.(row, { base: b, main: m, branch: br, landed, ours: s.ours.text });
      } catch { skipped++; }
    }
    hooks.done?.(commit!);
  }
  return { merges, fought, skipped, rows };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (n: string, d: number) => Number(args[args.indexOf(n) + 1]) || d;
  const repo = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (!repo) { console.error("usage: bun scripts/mervin-corpus.ts <repo> [--limit 300] [--max-lines 3000] [--json] [--show 10]"); process.exit(2); }
  const show = flag("--show", 0);
  const { merges, fought: foughtMerges, skipped, rows } = run(repo, flag("--limit", 300), flag("--max-lines", 3000));
  const count = (rs: Row[]) => Object.fromEntries(
    (["solved", "close", "wrong", "cards", "gap", "guard", "lock", "differ", "agree"] as Bucket[]).map((k) => [k, rs.filter((r) => r.bucket === k).length])) as Record<Bucket, number>;
  const fought = rows.filter((r) => ["solved", "close", "wrong", "cards", "guard", "lock"].includes(r.bucket));
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
  const by: Record<string, Row[]> = {};
  for (const r of rows) (by[r.ext] ??= []).push(r);
  const exts = Object.entries(by).sort((a, b) => b[1].length - a[1].length).slice(0, 12).map(([ext, rs]) => ({ ext, files: rs.length, ...count(rs) }));
  const total = count(rows);
  const summary = {
    repo, merges, conflictedMerges: foughtMerges, files: rows.length, skipped, buckets: total, gitConflicted: fought.length,
    solvedShare: fought.length ? (total.solved! + total.close!) / fought.length : NaN,
    wrongShare: fought.length ? total.wrong! / fought.length : NaN,
    byExtension: exts,
  };
  if (args.includes("--json")) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`${repo}: ${merges} merges scanned, ${foughtMerges} conflicted in git, ${rows.length} conflicted files replayed (${skipped} skipped: binary, huge or deleted on a side)`);
    for (const k of ["solved", "close", "wrong", "cards", "guard", "lock"] as const)
      console.log(`    ${k.padEnd(7)} ${String(total[k]).padStart(5)}  ${pct(total[k]!, fought.length)}`);
    console.log(`  git clean but Mervin conflicts (gap): ${total.gap}   clean but different text (differ): ${total.differ}`);
    console.log("  by extension:");
    for (const e of exts) console.log(`    ${e.ext.padEnd(8)} files ${String(e.files).padStart(5)}  solved ${e.solved}  close ${e.close}  wrong ${e.wrong}  cards ${e.cards}  gap ${e.gap}`);
    for (const r of rows.filter((r) => r.bucket === "wrong" || r.bucket === "gap").slice(0, show)) console.log(`  ${r.bucket} ${r.merge} ${r.path}`);
  }
}
