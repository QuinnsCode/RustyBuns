// Mervin runs the merge round: read the open PR board (mervin-board.ts), decide which PRs can go now and
// which wait, and say why, one line each. This is the piece of the office's PR agent that decides what merges
// next; the merging itself is GitHub's own auto-merge, so the main ruleset (PRs only, CI green) still has the
// last word.
//
//   bun scripts/mervin-merge.ts [1468 1478 ...] [--go] [--from prs.json]
//   bun scripts/mervin-merge.ts --stack [--push]
//
// `--stack` takes the PRs that are clean (go, and every file certain or agree: no merge logic needed) and joins
// them into one branch, `mervin/stack-<main>`, one merge commit per PR in the board's order, so the whole stack
// is one PR you merge (as a merge commit, which also marks the PRs inside it merged) and one `git revert -m1`
// undoes it, or `git revert -m1` of a single inner merge undoes one PR. It builds with git plumbing
// (merge-tree, commit-tree), so no worktree or checkout is touched. A PR git can't join cleanly onto the stack
// so far is left out and named. `--push` pushes the branch and opens the PR, its body listing what was combined.
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

/** The PRs worth stacking: clear to go, and every file needed no merge logic or both engines agreed. */
export function stackable(board: Board, verdicts: Verdict[]): number[] {
  const go = new Set(verdicts.filter((v) => v.go).map((v) => v.pr));
  return board.stages.filter((s) => go.has(s.pr) && s.files.every((f) => f.tier === "certain" || f.tier === "agree")).map((s) => s.pr);
}

/** One merge commit per PR on top of main, built with plumbing. Returns the tip and what joined or was left out. */
export function buildStack(git: (...a: string[]) => { code: number; out: string }, main: string, prs: BoardPr[], titles: Map<number, string>) {
  let tip = main;
  const joined: number[] = [], left: { pr: number; why: string }[] = [];
  for (const pr of prs.map((p) => p.number)) {
    const head = prs.find((p) => p.number === pr)!.headRefOid;
    if (git("cat-file", "-e", `${head}^{commit}`).code !== 0) git("fetch", "-q", "origin", `refs/pull/${pr}/head`);
    const t = git("merge-tree", "--write-tree", tip, head);
    if (t.code !== 0) { left.push({ pr, why: "does not join cleanly onto the stack so far" }); continue; }
    const c = git("commit-tree", t.out.split("\n")[0]!, "-p", tip, "-p", head, "-m", `Merge #${pr}: ${titles.get(pr) ?? ""}`);
    if (c.code !== 0) { left.push({ pr, why: c.out.trim() }); continue; }
    tip = c.out.trim(); joined.push(pr);
  }
  return { tip, joined, left };
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
  if (args.includes("--stack")) {
    const picks = stackable(board, verdicts);
    const titles = new Map(prs.map((p) => [p.number, p.title ?? ""]));
    const git = (...a: string[]) => { const r = Bun.spawnSync(["git", ...a], { cwd: top, stderr: "pipe" }); return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }; };
    const { tip, joined, left } = buildStack(git, main, picks.map((n) => prs.find((p) => p.number === n)!), titles);
    const branch = `mervin/stack-${main.slice(0, 9)}`;
    git("update-ref", `refs/heads/${branch}`, tip);
    say(`stack ${branch}: ${joined.length} PRs joined${left.length ? `, left out ${left.map((l) => `#${l.pr} (${l.why})`).join(", ")}` : ""}`);
    const held = verdicts.filter((v) => !v.go || !picks.includes(v.pr));
    const body = [
      `Mervin stacked ${joined.length} clean PRs onto main ${main.slice(0, 9)}, one merge commit each, so this is one thing to merge and one thing to undo.`,
      "", "## Combined", ...joined.map((n) => `- #${n} ${titles.get(n) ?? ""}`),
      ...(left.length ? ["", "## Left out (would not join cleanly)", ...left.map((l) => `- #${l.pr}: ${l.why}`)] : []),
      "", "## Not in this stack, and why", ...held.map((v) => `- #${v.pr}: ${v.go ? "needs the merge engine to settle a file, review it" : v.why}`),
      "", "## Merge and undo", "Merge this as a merge commit (not a squash) so GitHub marks the PRs inside it merged.",
      `Undo it all: \`git revert -m1 <the merge commit>\`. Undo one PR: \`git revert -m1 <that PR's merge commit in this branch>\`.`,
    ].join("\n");
    if (args.includes("--push")) {
      const pushed = git("push", "-u", "origin", `${branch}:${branch}`);
      say(pushed.code === 0 ? `pushed ${branch}` : `push FAILED: ${pushed.out.trim()}`);
      if (pushed.code === 0) {
        const r = Bun.spawnSync(["gh", "pr", "create", "--head", branch, "--base", "main", "--title", `Mervin stack: ${joined.length} clean PRs (${joined.map((n) => `#${n}`).join(" ")})`, "--body", body], { cwd: top, stderr: "pipe" });
        say(r.exitCode === 0 ? `opened ${r.stdout.toString().trim()}` : `gh pr create FAILED: ${r.stderr.toString().trim()}`);
      }
    } else console.log(`\n${body}\n\n(local branch only; add --push to push it and open the PR)`);
    process.exit(0);
  }
  const now = verdicts.filter((v) => v.go && v.wave === 1);
  say(`${now.length} to merge now, ${verdicts.filter((v) => v.go).length - now.length} in later waves, ${verdicts.filter((v) => !v.go).length} held`);
  if (!args.includes("--go")) { say("plan only; add --go to turn on auto-merge for wave 1"); process.exit(0); }
  for (const v of now) {
    const r = Bun.spawnSync(["gh", "pr", "merge", String(v.pr), "--auto", "--squash"], { cwd: top, stderr: "pipe" });
    say(`#${v.pr} auto-merge ${r.exitCode === 0 ? "on" : `FAILED: ${r.stderr.toString().trim()}`}`);
  }
  say("wave 1 is queued; rerun after it lands for the next wave");
}
