// Mervin runs the merge round: read the open PR board (mervin-board.ts), decide which PRs can go now and
// which wait, and say why, one line each. This is the piece of the office's PR agent that decides what merges
// next; the merging itself is GitHub's own auto-merge, so the main ruleset (PRs only, CI green) still has the
// last word.
//
//   bun scripts/mervin-merge.ts [1468 1478 ...] [--go] [--from prs.json]
//
// With no flag it only prints the plan (reads git and `gh pr list`). `--go` turns on `gh pr merge --auto
// --squash` for the first wave and nothing else; run it again after that wave lands, and the board is rebuilt
// on the new main. A PR is held when its CI failed, the board carded one of its files (Mervin couldn't carry its
// change), it is stacked on a PR that hasn't landed, it sits in a clash between files, or it waits behind a
// held PR that touches the same files. Every line is stamped so the run can be tailed.

import { run, order, ciOf, type Board, type BoardPr } from "./mervin-board.ts";

export interface Verdict { pr: number; title?: string; go: boolean; wave?: number; why: string; behind: number[] }

/** Wave 1 merges now; wave 2 touches files a wave 1 PR does, so it goes after that lands; a held PR holds those behind it. */
export function decide(board: Board, prs: BoardPr[]): Verdict[] {
  const byNum = new Map(prs.map((p) => [p.number, p]));
  const clashing = new Set(board.clashes.flatMap((c) => c.prs));
  const out = new Map<number, Verdict>();
  for (const s of board.stages) {
    const ci = ciOf(byNum.get(s.pr) ?? { number: s.pr, headRefOid: s.head });
    const behind = [...new Set(s.files.flatMap((f) => f.after))].filter((n) => out.has(n));
    const cards = s.files.filter((f) => f.tier === "card").map((f) => f.path);
    let why = "";
    if (ci.ci === "fail") why = `CI failed: ${ci.failing.join(", ")}`;
    else if (cards.length) why = `Mervin asks on ${cards.join(", ")}`;
    else if (clashing.has(s.pr)) why = `clashes across files: ${board.clashes.filter((c) => c.prs.includes(s.pr)).map((c) => `${c.kind} ${c.key}`).join("; ")}`;
    else if (s.stackedOn !== undefined) why = `stacked on #${s.stackedOn}, which hasn't landed`;
    else {
      const held = behind.find((n) => !out.get(n)!.go);
      if (held) why = `waits behind held #${held}`;
    }
    if (why) { out.set(s.pr, { pr: s.pr, title: s.title, go: false, why, behind }); continue; }
    const wave = 1 + Math.max(0, ...behind.map((n) => out.get(n)!.wave ?? 0));
    out.set(s.pr, { pr: s.pr, title: s.title, go: true, wave, why: wave === 1 ? "clear to merge" : `after ${behind.map((n) => `#${n}`).join(", ")}`, behind });
  }
  for (const k of board.skipped) out.set(k.pr, { pr: k.pr, go: false, why: `skipped: ${k.why}`, behind: [] });
  return [...out.values()];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const say = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} mervin: ${m}`);
  const top = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"]).stdout.toString().trim();
  const from = arg("from");
  const prs: BoardPr[] = JSON.parse(from ? await Bun.file(from).text()
    : Bun.spawnSync(["gh", "pr", "list", "--state", "open", "--limit", "200", "--json", "number,title,headRefOid,headRefName,baseRefName,statusCheckRollup"], { cwd: top }).stdout.toString() || "[]");
  const main = Bun.spawnSync(["git", "rev-parse", "origin/main"], { cwd: top }).stdout.toString().trim();
  const given = args.filter((a, i) => /^\d+$/.test(a) && !args[i - 1]?.startsWith("--")).map(Number);
  say(`reading ${prs.length} open PRs against main ${main.slice(0, 9)}`);
  const { board } = run(top, main, order(prs, given.length ? given : undefined));
  const verdicts = decide(board, prs);
  for (const v of verdicts) say(`#${v.pr} ${v.go ? `wave ${v.wave}` : "HOLD"}: ${v.why}${v.title ? `  (${v.title})` : ""}`);
  const now = verdicts.filter((v) => v.go && v.wave === 1);
  say(`${now.length} to merge now, ${verdicts.filter((v) => v.go).length - now.length} in later waves, ${verdicts.filter((v) => !v.go).length} held`);
  if (!args.includes("--go")) { say("plan only; add --go to turn on auto-merge for wave 1"); process.exit(0); }
  for (const v of now) {
    const r = Bun.spawnSync(["gh", "pr", "merge", String(v.pr), "--auto", "--squash"], { cwd: top, stderr: "pipe" });
    say(`#${v.pr} auto-merge ${r.exitCode === 0 ? "on" : `FAILED: ${r.stderr.toString().trim()}`}`);
  }
  say("wave 1 is queued; rerun after it lands for the next wave");
}
