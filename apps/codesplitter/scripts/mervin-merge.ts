// Mervin runs the merge round: read the open PR board (mervin-board.ts), decide which PRs can go now and
// which wait, and say why, one line each. This is the piece of the office's PR agent that decides what merges
// next; the merging itself is GitHub's own auto-merge, so the main ruleset (PRs only, CI green) still has the
// last word.
//
//   bun scripts/mervin-merge.ts [1468 1478 ...] [--go] [--from prs.json] [--main-red check,check]
//   bun scripts/mervin-merge.ts --stack [--push]
//
// Every run is recorded so a bad round can be replayed: the PR list as `gh` gave it (head shas, CI), main's sha,
// the board and the verdicts, and the stack's tip, go to `.mervin/rounds/<time>-<main>.json` (`--record <dir>`
// to move it; `--no-record` to skip). It also pins each PR head at `refs/mervin/pr-<n>-<sha>`, so a force push
// can't take the commit away. `--replay <file>` runs the same decisions again on exactly that input.
//
// `--stack` takes the PRs that are clean (go, and every file certain or agree: no merge logic needed) and joins
// them into one branch, `mervin/stack-<main>`, one merge commit per PR in the board's order, so the whole stack
// is one PR you merge (as a merge commit, which also marks the PRs inside it merged) and one `git revert -m1`
// undoes it, or `git revert -m1` of a single inner merge undoes one PR. It builds with git plumbing
// (merge-tree, commit-tree), so no worktree or checkout is touched. A PR git can't join cleanly onto the stack
// so far is left out and named. `--push` pushes the branch and opens the PR, its body listing what was combined.
//
// With no flag it only prints the plan (reads git and `gh pr list`). `--go` turns on `gh pr merge --auto`
// (--squash, or --merge for a stack; `--method` overrides and warns) for the first wave and nothing else; run it again after that wave lands, and the board is rebuilt
// on the new main. A PR is held when its CI failed, the board carded one of its files (Mervin couldn't carry its
// change), it is stacked on a PR that hasn't landed, it sits in a clash between files, or it waits behind a
// held PR that touches the same files. Every line is stamped so the run can be tailed.
//
// Live (#1731): `--live` also appends the run's events to `.mervin/live.ndjson` for the watch page
// (`bun scripts/mervin-watch.ts`). `--go` waits on `.mervin/pause` before each `gh pr merge --auto`, so the page's
// pause button holds the next merge for real, and resuming lets it go on. `--pause-dir` moves both files.

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { run, order, ciOf, type Board, type BoardPr } from "./mervin-board.ts";
import { events, FEED, PAUSE, costOf, type Ev, type Round } from "../src/mervin-replay.ts";

export interface Verdict { pr: number; title?: string; go: boolean; wave?: number; why: string; behind: number[]; method?: "squash" | "merge" }

/** The checks the main ruleset requires. One that hasn't reported yet is pending, never passed (#1542). */
export const REQUIRED_CHECKS = ["typecheck", "apps"];

/** Wave 1 merges now; wave 2 touches files a wave 1 PR does, so it goes after that lands; a held PR holds those behind it. */
export function decide(board: Board, prs: BoardPr[], mainRed: string[] = []): Verdict[] {
  const byNum = new Map(prs.map((p) => [p.number, p]));
  const open = board.clashes.filter((c) => !c.settled);
  const heads = new Set(prs.map((p) => p.headRefName).filter(Boolean));
  const bases = new Set(prs.map((p) => p.baseRefName).filter(Boolean));
  const clashing = new Set(open.flatMap((c) => c.prs));
  const out = new Map<number, Verdict>();
  for (const s of board.stages) {
    const ci = ciOf(byNum.get(s.pr) ?? { number: s.pr, headRefOid: s.head });
    const behind = [...new Set(s.files.flatMap((f) => f.after))].filter((n) => out.has(n));
    const cards = s.files.filter((f) => f.tier === "card").map((f) => f.path);
    const vsMain = s.files.filter((f) => f.main).map((f) => f.path);
    let why = "";
    const pr = byNum.get(s.pr);
    const reported = new Set((pr?.statusCheckRollup ?? []).map((c) => c.name));
    const missing = pr?.statusCheckRollup?.length ? REQUIRED_CHECKS.filter((n) => !reported.has(n)) : [];
    if (ci.ci === "fail") why = `CI failed: ${ci.failing.join(", ")}${ci.failing.every((n) => mainRed.includes(n)) ? " (also failing on main, rerun once main is fixed)" : ""}`;
    else if (pr?.baseRefName && pr.baseRefName !== "main" && !heads.has(pr.baseRefName)) why = `base branch ${pr.baseRefName} is gone or already merged, retarget to main`;
    else if (missing.length) why = `required check not reported yet: ${missing.join(", ")}`;
    else if (ci.ci === "pending") why = "CI still running";
    else if (cards.length) why = `Mervin asks on ${cards.join(", ")}`;
    else if (vsMain.length) why = `conflicts with main on ${vsMain.join(", ")}`;
    else if (clashing.has(s.pr)) why = `clashes across files: ${open.filter((c) => c.prs.includes(s.pr)).map((c) => `${c.kind} ${c.key}`).join("; ")}`;
    else if (s.stackedOn !== undefined) why = `stacked on #${s.stackedOn}, which hasn't landed`;
    else {
      const held = behind.find((n) => !out.get(n)!.go);
      if (held) why = `waits behind held #${held}`;
    }
    if (why) { out.set(s.pr, { pr: s.pr, title: s.title, go: false, why, behind }); continue; }
    const wave = 1 + Math.max(0, ...behind.map((n) => out.get(n)!.wave ?? 0));
    const method = s.stackedOn !== undefined || (pr?.headRefName && bases.has(pr.headRefName)) ? "merge" : "squash";
    out.set(s.pr, { pr: s.pr, title: s.title, go: true, wave, method, why: wave === 1 ? "clear to merge" : `after ${behind.map((n) => `#${n}`).join(", ")}`, behind });
  }
  for (const k of board.skipped) out.set(k.pr, { pr: k.pr, go: false, why: `skipped: ${k.why}`, behind: [] });
  return [...out.values()];
}

/** Appends an event to the live feed the watch page reads. */
export function emitTo(dir: string, e: Ev) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, FEED), `${JSON.stringify({ ...e, ms: costOf(e) })}\n`);
}

/** Blocks while the pause file is there (the watch page's pause button writes it); `held` fires once when it starts waiting. */
export async function waitWhilePaused(dir: string, held: () => void = () => {}, every = 500, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  const file = join(dir, PAUSE);
  if (!existsSync(file)) return false;
  held();
  while (existsSync(file)) await sleep(every);
  return true;
}

/** PRs with auto-merge already on (by hand) whose base is dead or whose parent hasn't landed: merging them strands the commit (#1545). */
export function strayAutoMerges(prs: BoardPr[], verdicts: Verdict[]): number[] {
  const auto = new Set(prs.filter((p) => p.autoMergeRequest).map((p) => p.number));
  return verdicts.filter((v) => !v.go && auto.has(v.pr) && (v.why.includes("retarget to main") || v.why.startsWith("stacked on"))).map((v) => v.pr);
}

/** The PRs worth stacking: clear to go, and every file needed no merge logic or both engines agreed. */
export function stackable(board: Board, verdicts: Verdict[]): number[] {
  const go = new Set(verdicts.filter((v) => v.go).map((v) => v.pr));
  return board.stages.filter((s) => go.has(s.pr) && s.files.every((f) => f.tier === "certain" || f.tier === "agree")).map((s) => s.pr);
}

export type Who = "none" | "one agent" | "two agents" | "a swarm" | "a human";
export interface Advice { pr: number; who: Who; why: string; blocks: number[] }
export interface Heads { warnings: string[]; advice: Advice[]; stack: number[] }

/** Files an agent should not settle alone: lockfiles, migrations, deploy files. */
const RISKY = /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|migrations\/.*|wrangler\.(jsonc?|toml)|alchemy\.run\.ts|rustybuns\.config\.ts|\.github\/workflows\/.*|Dockerfile)$/;
/** A PR this many others wait behind is the one to fix first, and worth a swarm. */
const SWARM_AT = 3;
/** This many PRs sharing files or clashes is "a lot of overlap incoming". */
const OVERLAP_AT = 3;

/**
 * Where Mervin speaks up (#1519): warns when open PRs overlap, offers the clean ones as a stack, and for each held PR
 * recommends who steps in. Held PRs come ranked: the red PR that blocks the most others first, then by size.
 * It only advises; the person decides order and can override.
 */
export function advise(board: Board, verdicts: Verdict[]): Heads {
  const stageOf = new Map(board.stages.map((s) => [s.pr, s]));
  const open = board.clashes.filter((c) => !c.settled);
  // who waits behind whom, through any depth
  const blocks = (pr: number): number[] => {
    const seen = new Set<number>(), todo = [pr];
    for (let n = todo.pop(); n !== undefined; n = todo.pop()) for (const v of verdicts) if (!v.go && !seen.has(v.pr) && v.behind.includes(n)) { seen.add(v.pr); todo.push(v.pr); }
    return [...seen];
  };
  const overlapping = new Set<number>(board.stages.filter((s) => s.files.some((f) => f.after.length)).flatMap((s) => [s.pr, ...s.files.flatMap((f) => f.after)]));
  for (const c of board.clashes) for (const n of c.prs) overlapping.add(n);
  const warnings: string[] = [];
  if (overlapping.size >= OVERLAP_AT) {
    const kinds = [...new Set(open.map((c) => c.kind))];
    warnings.push(`a lot of overlap incoming: ${overlapping.size} open PRs share files${kinds.length ? ` or collide on ${kinds.join(", ")}` : ""}. Put an agent on it, or let me stack the easy ones.`);
  }
  const stack = stackable(board, verdicts);
  if (stack.length > 1) warnings.push(`${stack.length} PRs are easy (${stack.map((n) => `#${n}`).join(" ")}): \`mervin-merge.ts --stack\` joins them into one PR whose own tested result is what CI checks.`);
  const advice: Advice[] = [];
  for (const v of verdicts.filter((x) => !x.go)) {
    const s = stageOf.get(v.pr), files = s?.files ?? [];
    const behindMe = blocks(v.pr);
    const mine = open.filter((c) => c.prs.includes(v.pr));
    const flagged = files.filter((f) => f.tier === "card" || f.tier === "differ" || RISKY.test(f.path)).map((f) => f.path);
    let who: Who, why: string;
    if (flagged.length || mine.some((c) => c.kind === "migration")) { who = "a human"; why = `${flagged.length ? flagged.join(", ") : "a migration stamp"} needs a person's eyes`; }
    else if (behindMe.length >= SWARM_AT) { who = "a swarm"; why = `${behindMe.length} PRs wait behind it`; }
    else if (mine.length || v.why.startsWith("conflicts with main")) { who = "two agents"; why = mine.length ? `clashes with ${[...new Set(mine.flatMap((c) => c.prs).filter((n) => n !== v.pr))].map((n) => `#${n}`).join(", ") || "main"}` : "conflicts with main"; }
    else if (v.why.includes("retarget to main")) { who = "one agent"; why = `its base branch has no open PR, so a merge would land in a dead branch and never reach main: \`gh pr edit ${v.pr} --base main\`, then rerun`; }
    else if (v.why.startsWith("stacked on") || v.why.startsWith("waits behind") || v.why.startsWith("CI still") || v.why.startsWith("required check")) { who = "none"; why = `waiting: ${v.why}`; }
    else { who = "one agent"; why = `${files.length} file${files.length === 1 ? "" : "s"}: ${v.why}`; }
    advice.push({ pr: v.pr, who, why, blocks: behindMe });
  }
  const rank = (a: Advice) => a.blocks.length;
  advice.sort((a, b) => rank(b) - rank(a) || (stageOf.get(a.pr)?.files.length ?? 0) - (stageOf.get(b.pr)?.files.length ?? 0) || a.pr - b.pr);
  const first = advice.find((a) => a.blocks.length);
  if (first) warnings.push(`#${first.pr} blocks ${first.blocks.map((n) => `#${n}`).join(" ")}: fix it before the PRs behind it.`);
  return { warnings, advice, stack };
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
  const replay = arg("replay");
  const rec = replay ? JSON.parse(await Bun.file(replay).text()) : undefined;
  const from = arg("from");
  const prs: BoardPr[] = rec ? rec.prs : JSON.parse(from ? await Bun.file(from).text()
    : Bun.spawnSync(["gh", "pr", "list", "--state", "open", "--limit", "200", "--json", "number,title,headRefOid,headRefName,baseRefName,autoMergeRequest,statusCheckRollup"], { cwd: top }).stdout.toString() || "[]");
  const main: string = rec ? rec.main : Bun.spawnSync(["git", "rev-parse", "origin/main"], { cwd: top }).stdout.toString().trim();
  const given = args.filter((a, i) => /^\d+$/.test(a) && !args[i - 1]?.startsWith("--")).map(Number);
  say(`reading ${prs.length} open PRs against main ${main.slice(0, 9)}`);
  const { board } = run(top, main, order(prs, given.length ? given : undefined));
  const verdicts = decide(board, prs, (arg("main-red") ?? "").split(",").filter(Boolean));
  const file = join(resolve(arg("record") ?? join(top, ".mervin/rounds")), `${new Date().toISOString().replace(/[:.]/g, "-")}-${main.slice(0, 9)}.json`);
  const recorded: Record<string, unknown> = { at: new Date().toISOString(), main, replayOf: replay, prs, board, verdicts };
  const save = () => {
    if (args.includes("--no-record") || replay) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(recorded, null, 2));
    const bucket = arg("upload");
    if (bucket) {
      const key = `mervin/rounds/${file.split("/").pop()}`;
      try {
      const r = Bun.spawnSync(["bunx", "wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", "application/json", "--remote"], { cwd: top, stderr: "pipe" });
      say(r.exitCode === 0 ? `uploaded r2://${bucket}/${key}` : `upload FAILED: ${r.stderr.toString().trim().split("\n").pop()}`);
      } catch (e) { say(`upload FAILED: ${(e as Error).message}`); }
    }
  };
  if (!args.includes("--no-record") && !replay) {
    for (const p of prs) Bun.spawnSync(["git", "update-ref", `refs/mervin/pr-${p.number}-${p.headRefOid.slice(0, 9)}`, p.headRefOid], { cwd: top });
    save(); say(`recorded ${file}`);
  }
  const heads = advise(board, verdicts);
  for (const v of verdicts) say(`#${v.pr} ${v.go ? `wave ${v.wave}` : "HOLD"}: ${v.why}${v.title ? `  (${v.title})` : ""}`);
  for (const w of heads.warnings) say(`warning: ${w}`);
  for (const a of heads.advice) say(`#${a.pr} suggest ${a.who}: ${a.why}${a.blocks.length ? ` (blocks ${a.blocks.map((n) => `#${n}`).join(" ")})` : ""}`);
  recorded.advice = heads; save();
  if (args.includes("--stack")) {
    const picks = stackable(board, verdicts);
    const titles = new Map(prs.map((p) => [p.number, p.title ?? ""]));
    const git = (...a: string[]) => { const r = Bun.spawnSync(["git", ...a], { cwd: top, stderr: "pipe" }); return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }; };
    const { tip, joined, left } = buildStack(git, main, picks.map((n) => prs.find((p) => p.number === n)!), titles);
    const branch = `mervin/stack-${main.slice(0, 9)}`;
    git("update-ref", `refs/heads/${branch}`, tip);
    recorded.stack = { branch, tip, joined, left }; save();
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
  const stray = strayAutoMerges(prs, verdicts);
  for (const n of stray) say(`#${n} warning: auto-merge is on but its base is dead or its parent hasn't landed${args.includes("--go") ? ", turning it off" : " (--go turns it off)"}`);
  if (args.includes("--go")) for (const n of stray) {
    const r = Bun.spawnSync(["gh", "pr", "merge", String(n), "--disable-auto"], { cwd: top, stderr: "pipe" });
    say(`#${n} auto-merge ${r.exitCode === 0 ? "off" : `FAILED to turn off: ${r.stderr.toString().trim()}`}`);
  }
  const dir = resolve(arg("pause-dir") ?? join(top, ".mervin"));
  const live = args.includes("--live") ? dir : undefined;
  const planned = events({ board, verdicts } as unknown as Round);
  if (live) for (const e of planned) if (e.kind === "round" || e.kind === "hold" || (e.kind === "wave" && e.wave === 1)) emitTo(live, e);
  if (!args.includes("--go")) { say("plan only; add --go to turn on auto-merge for wave 1"); process.exit(0); }
  for (const v of now) {
    const method = (arg("method") as "squash" | "merge" | undefined) ?? v.method ?? "squash";
    if (method !== v.method) say(`#${v.pr} warning: using --${method}, Mervin recommends --${v.method} (${v.method === "merge" ? "part of a stack" : "a plain PR"})`);
    const paused = await waitWhilePaused(dir, () => { say(`paused: holding #${v.pr} (remove ${join(dir, PAUSE)} or press play on the watch page)`); if (live) emitTo(live, { kind: "pause", paused: true }); });
    if (paused) { say("resumed"); if (live) emitTo(live, { kind: "pause", paused: false }); }
    const r = Bun.spawnSync(["gh", "pr", "merge", String(v.pr), "--auto", `--${method}`], { cwd: top, stderr: "pipe" });
    say(`#${v.pr} auto-merge ${r.exitCode === 0 ? "on" : `FAILED: ${r.stderr.toString().trim()}`}`);
    if (live && r.exitCode === 0) for (const e of planned) if ("pr" in e && e.pr === v.pr && e.kind !== "merged" && e.kind !== "hold") emitTo(live, e);
  }
  say("wave 1 is queued; rerun after it lands for the next wave");
}
