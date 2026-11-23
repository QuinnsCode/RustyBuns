// Before you open a PR: will this branch merge after the other open PRs that change the same files? (#3118)
// First the cheap part (one `gh pr list`, one `git diff`): which open PRs share a file with you. When any do,
// Mervin's board runs in memory, those PRs first (they are older, they land first) and this branch's HEAD last,
// and says how each of your files merges: certain or agree (fine), mervin (git conflicts, Mervin settles it:
// rebase after they land), differ (both clean, different text: look), card (a person must choose), plus clashes
// that merge clean as text and break later (two migrations with one stamp, one export added twice).
//
//   bun scripts/preflight.ts [--base origin/main] [--json]
//
// Before all that it names any file the branch rolls back to a copy main had before a recent commit (#5687).
//
// Reads git and `gh` only; commit first, it merges HEAD, not the working tree. Exits 1 on a rollback, a card or an
// unsettled clash in your files (so a hook can stop and ask), 0 otherwise. It prints a `Merge after #N` line for the PR body;
// scripts/after.ts (after.yml) merges main into the branch once those land (#5344). It notes the HEAD it read in the worktree's git folder
// (`rustybuns-preflight`) with the PRs it named, and .claude/hooks/guard.ts turns away `gh pr create` on a commit it
// hasn't read (#4956), or whose body lacks that `Merge after` line (#5344). Lock and generated files are listed apart:
// they are expected to clash and are regenerated.

import { arr, int, obj, str, type Of } from "../packages/util/src/guard.ts";
import { GENERATED } from "../packages/util/src/overlap.ts";
import { type Board, type Clash, type FileRow, run } from "../apps/codesplitter/scripts/mervin-board.ts";
import { noteSaved } from "./conflicts-saved.ts";

/** One row of `gh pr list --json number,title,headRefName,headRefOid,files`. */
export const OpenPr = obj({
  number: int(1, Infinity), title: str(Infinity, { min: 0 }), headRefName: str(Infinity),
  headRefOid: str(40, { min: 40, re: /^[0-9a-f]+$/ }), files: arr(obj({ path: str(Infinity) }), Infinity),
});
export type OpenPr = Of<typeof OpenPr>;
export interface Overlap { pr: number; title: string; files: string[] }


/** The open PRs sharing at least one non-generated file with `mine`, most shared first; `branch` is skipped (your own PR). */
export function overlaps(mine: string[], prs: OpenPr[], branch = ""): { clash: Overlap[]; generated: Overlap[] } {
  const own = new Set(mine);
  const clash: Overlap[] = [], generated: Overlap[] = [];
  for (const p of prs) {
    if (p.headRefName === branch) continue;
    const shared = p.files.map((f) => f.path).filter((f) => own.has(f));
    const real = shared.filter((f) => !GENERATED.some((g) => g.test(f)));
    if (real.length) clash.push({ pr: p.number, title: p.title, files: real });
    else if (shared.length) generated.push({ pr: p.number, title: p.title, files: shared });
  }
  clash.sort((a, b) => b.files.length - a.files.length);
  return { clash, generated };
}

/** This branch's stage on the board, as PR `ME`. */
export const ME = 0;

/** What Mervin's board says about this branch's files: fine, settled by Mervin, to look at, or for a person. */
export function verdict(board: Board): { settles: FileRow[]; look: FileRow[]; cards: FileRow[]; clashes: Clash[]; skipped: Board["skipped"] } {
  const files = board.stages.find((s) => s.pr === ME)?.files ?? [];
  return {
    settles: files.filter((f) => f.tier === "mervin"),
    look: files.filter((f) => f.tier === "differ"),
    cards: files.filter((f) => f.tier === "card"),
    clashes: board.clashes.filter((c) => c.prs.includes(ME) && !c.settled),
    skipped: board.skipped,
  };
}

/** A file this branch puts back the way it was before `commit` (already on main) changed it. */
export interface Rollback { path: string; commit: string; subject: string }

/**
 * Files the branch rolls back (#5687): the branch's copy of a file is exactly the one main had just before a commit
 * from the last `days` days before the merge-base, a file it deletes being one such a commit created. A commit made
 * in a worktree that sat on an old main and was then reset onto the new one does this (#5600, #5626): the squash keeps
 * the old copies and undoes work nobody meant to touch. One `git diff` and one `git log`; generated files are skipped.
 */
export function rollbacks(git: (...a: string[]) => string, base: string, head = "HEAD", days = 14): Rollback[] {
  const mb = git("merge-base", base, head).trim();
  const raw = (line: string) => /^:\d+ \d+ ([0-9a-f]{40}) ([0-9a-f]{40}) \w+\t(.+)$/.exec(line);
  const mine = new Map<string, string>(); // path -> the branch's blob (zeros when it deletes the file)
  for (const line of git("diff", "--raw", "--no-abbrev", "--no-renames", mb, head).split("\n")) {
    const m = raw(line);
    if (m && !GENERATED.some((g) => g.test(m[3]!))) mine.set(m[3]!, m[2]!);
  }
  if (!mine.size) return [];
  const since = Number(git("log", "-1", "--format=%ct", mb).trim()) - days * 86400;
  const out: Rollback[] = [];
  let at: { commit: string; ct: number; subject: string } | undefined;
  for (const line of git("log", "--raw", "--no-abbrev", "--no-renames", "--format=@@ %H %ct %s", "-n", "500", mb, "--", ...mine.keys()).split("\n")) {
    const c = /^@@ ([0-9a-f]{40}) (\d+) (.*)$/.exec(line);
    if (c) { at = { commit: c[1]!, ct: Number(c[2]), subject: c[3]! }; continue; }
    const m = raw(line);
    if (!m || !at || at.ct < since || mine.get(m[3]!) !== m[1]) continue;
    out.push({ path: m[3]!, commit: at.commit, subject: at.subject });
    mine.delete(m[3]!); // newest such commit only
  }
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const base = args.includes("--base") ? args[args.indexOf("--base") + 1]! : "origin/main";
  const run$ = (cmd: string[]) => {
    const r = Bun.spawnSync(cmd, { stderr: "pipe" });
    if (r.exitCode !== 0) { console.error(`${cmd.join(" ")}: ${r.stderr.toString().trim()}`); process.exit(2); }
    return r.stdout.toString();
  };
  const mine = run$(["git", "diff", "--name-only", `${base}...HEAD`]).split("\n").filter(Boolean);
  const branch = run$(["git", "rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const head = run$(["git", "rev-parse", "HEAD"]).trim();
  const prs = arr(OpenPr, Infinity)(JSON.parse(run$(["gh", "pr", "list", "--state", "open", "--limit", "100", "--json", "number,title,headRefName,headRefOid,files"])));
  const back = rollbacks((...a) => run$(["git", ...a]), base);
  const { clash, generated } = overlaps(mine, prs, branch);
  const others = clash.map((o) => prs.find((p) => p.number === o.pr)!);
  const v = others.length ? verdict(run(undefined, run$(["git", "rev-parse", base]).trim(), [...others, { number: ME, title: "this branch", headRefOid: head, headRefName: branch }]).board) : undefined;
  // Each file Mervin settles for this branch is a conflict nobody fights: counted once per branch and file.
  for (const f of v?.settles ?? []) noteSaved("preflight", `preflight ${branch} ${f.path}`);
  if (args.includes("--json")) console.log(JSON.stringify({ clash, generated, rollbacks: back, ...(v && { mervin: v }) }, null, 2));
  else {
    if (back.length) {
      console.log("This branch puts back older copies of files main has changed since (#5687):");
      for (const r of back) console.log(`  ${r.path}  undoes ${r.commit.slice(0, 9)} ${r.subject}`);
      console.log(`Unless you meant to revert them, take main's copy and commit: git checkout ${base} -- ${back.map((r) => r.path).join(" ")}\n`);
    }
    for (const o of clash) console.log(`#${o.pr} ${o.title}\n  also changes: ${o.files.slice(0, 8).join(", ")}${o.files.length > 8 ? ` (+${o.files.length - 8})` : ""}`);
    for (const o of generated) console.log(`#${o.pr} shares only generated files (${o.files.join(", ")}): regenerate after merging main`);
    if (!v) console.log("no other open PR changes your files");
    else {
      const after = (f: FileRow) => f.after.length ? `  (after ${f.after.map((n) => `#${n}`).join(", ")})` : "";
      console.log(`\nMervin's board, your branch merged after ${others.map((p) => `#${p.number}`).join(" ")}:`);
      for (const s of v.skipped) console.log(`  skipped #${s.pr}: ${s.why}`);
      for (const f of v.cards) console.log(`  card    ${f.path}  ${f.why}${after(f)}`);
      for (const c of v.clashes) console.log(`  clash   ${c.kind} ${c.key} with ${c.prs.filter((n) => n !== ME).map((n) => `#${n}`).join(", ") || "main"}`);
      for (const f of v.look) console.log(`  differ  ${f.path}  ${f.why}${after(f)}`);
      for (const f of v.settles) console.log(`  mervin  ${f.path}  ${f.why}${after(f)}`);
      if (v.cards.length || v.clashes.length) console.log("\nA person must choose these: wait for those PRs to merge and rebase, or talk to their workers before opening yours.");
      else if (v.settles.length || v.look.length) console.log("\nIt merges, with conflicts Mervin settles: open the PR with the Merge after line below.");
      else console.log("  every shared file merges clean");
    }
    if (others.length) console.log(`\nPut this line in the PR body; scripts/after.ts merges main in once they land:\n  Merge after ${others.map((p) => `#${p.number}`).join(", ")}`);
  }
  const code = back.length || (v && (v.cards.length || v.clashes.length)) ? 1 : 0;
  const stamp = run$(["git", "rev-parse", "--path-format=absolute", "--git-path", "rustybuns-preflight"]).trim();
  await Bun.write(stamp, `${head} ${code} ${others.map((p) => p.number).join(",")}\n`);
  process.exit(code);
}
