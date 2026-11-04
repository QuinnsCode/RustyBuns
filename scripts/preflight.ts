// Before you open a PR: will this branch merge after the other open PRs that change the same files? (#3118)
// First the cheap part (one `gh pr list`, one `git diff`): which open PRs share a file with you. When any do,
// Mervin's board runs in memory, those PRs first (they are older, they land first) and this branch's HEAD last,
// and says how each of your files merges: certain or agree (fine), mervin (git conflicts, Mervin settles it:
// rebase after they land), differ (both clean, different text: look), card (a person must choose), plus clashes
// that merge clean as text and break later (two migrations with one stamp, one export added twice).
//
//   bun scripts/preflight.ts [--base origin/main] [--json]
//
// Reads git and `gh` only; commit first, it merges HEAD, not the working tree. Exits 1 on a card or an unsettled
// clash in your files (so a hook can stop and ask), 0 otherwise. Lock and generated files are listed apart:
// they are expected to clash and are regenerated.

import { arr, int, obj, str, type Of } from "../packages/util/src/guard.ts";
import { GENERATED } from "../packages/util/src/overlap.ts";
import { type Board, type Clash, type FileRow, run } from "../apps/codesplitter/scripts/mervin-board.ts";

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
  const { clash, generated } = overlaps(mine, prs, branch);
  const others = clash.map((o) => prs.find((p) => p.number === o.pr)!);
  const v = others.length ? verdict(run(undefined, run$(["git", "rev-parse", base]).trim(), [...others, { number: ME, title: "this branch", headRefOid: head, headRefName: branch }]).board) : undefined;
  if (args.includes("--json")) console.log(JSON.stringify({ clash, generated, ...(v && { mervin: v }) }, null, 2));
  else {
    for (const o of clash) console.log(`#${o.pr} ${o.title}\n  also changes: ${o.files.slice(0, 8).join(", ")}${o.files.length > 8 ? ` (+${o.files.length - 8})` : ""}`);
    for (const o of generated) console.log(`#${o.pr} shares only generated files (${o.files.join(", ")}): regenerate after merging main`);
    if (!v) console.log("no other open PR changes your files");
    else {
      const after = (f: FileRow) => f.after.length ? `  (after ${f.after.map((n) => `#${n}`).join(", ")})` : "";
      console.log(`\nMervin, your branch merged after ${others.map((p) => `#${p.number}`).join(" ")}:`);
      for (const s of v.skipped) console.log(`  skipped #${s.pr}: ${s.why}`);
      for (const f of v.cards) console.log(`  card    ${f.path}  ${f.why}${after(f)}`);
      for (const c of v.clashes) console.log(`  clash   ${c.kind} ${c.key} with ${c.prs.filter((n) => n !== ME).map((n) => `#${n}`).join(", ") || "main"}`);
      for (const f of v.look) console.log(`  differ  ${f.path}  ${f.why}${after(f)}`);
      for (const f of v.settles) console.log(`  mervin  ${f.path}  ${f.why}${after(f)}`);
      if (v.cards.length || v.clashes.length) console.log("\nA person must choose these: wait for those PRs to merge and rebase, or talk to their workers before opening yours.");
      else if (v.settles.length || v.look.length) console.log("\nIt merges, with conflicts Mervin settles: open the PR, and rebase once they land.");
      else console.log("  every shared file merges clean");
    }
  }
  process.exit(v && (v.cards.length || v.clashes.length) ? 1 : 0);
}
