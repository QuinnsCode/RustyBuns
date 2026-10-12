// Merge plan replay (#1155): would the plan (src/merge-plan.ts) have put each PR that had to take main
// in behind the PR that made it? Each "merge main into the PR" fix commit (first parent the PR branch,
// second main) is a PR that waited. From the two sides' merge base, main's first-parent commits up to the
// fix's main parent are the PRs that landed meanwhile, one squash each. A landed PR blocks the branch when
// the branch merged clean onto main just before it and not just after it, file by file: the plan's clash
// test, with main's own history as the first branch. It's run twice: by git's merge, which is what the PR
// agent had to go on, and by codeSplitter's (shadow.ts lineMerge: line ids, then the lint), which is what
// the plan uses. The waves are the branches and their blockers, in the order they landed.
//
//   bun scripts/merge-plan.ts [0fb458f e49e19a ...] [--json]
//
// With no commits it replays the 2026-10-12 fixes (docs/merge-solutions.md §10, plus #1148's). Reads
// local git only.

import { gitMerge, lineMerge } from "./shadow.ts";
import { waves, type Clash } from "../src/merge-plan.ts";

/** That day's merge-main fixes: the PR, and the PR that the person merging main in named as the cause, where they did. */
export const CASES = [
  { pr: 1081, commit: "e49e19a" },
  { pr: 1093, commit: "02e1045", blocker: 1087 },
  { pr: 1093, commit: "b070fd8", blocker: 1102 },
  { pr: 1100, commit: "401eeda" },
  { pr: 1110, commit: "e2f2145" },
  { pr: 1115, commit: "2086218" },
  { pr: 1119, commit: "db4095c" },
  { pr: 1124, commit: "03e9127" },
  { pr: 1148, commit: "0fb458f" },
];

const top = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"]).stdout.toString().trim();
const git = (...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd: top, stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
};
const show = (rev: string, path: string) => {
  const r = Bun.spawnSync(["git", "show", `${rev}:${path}`], { cwd: top, stderr: "pipe" });
  return r.exitCode === 0 ? r.stdout.toString() : "";
};
const changed = (from: string, to: string) => new Set(git("diff", "--name-only", "--no-renames", from, to).split("\n").filter(Boolean));
/** A squash's PR: the last (#n) in its subject. */
const prOf = (subject: string) => Number([...subject.matchAll(/\(#(\d+)\)/g)].at(-1)?.[1]) || undefined;

/** A PR that landed while the branch was open, and where it stopped the branch merging clean. */
export interface Blocker { pr?: number; commit: string; files: string[] }
export interface Replayed { commit: string; pr?: number; named?: number; landed: number; git: Blocker[]; ours: Blocker[] }

export function replay(commit: string, pr?: number, named?: number): Replayed {
  const [branch, main] = git("rev-list", "--parents", "-n1", commit).trim().split(" ").slice(1);
  if (!branch || !main) throw new Error(`${commit} isn't a merge commit`);
  const base = git("merge-base", main, branch).trim();
  const mine = changed(base, branch);
  const landed = git("rev-list", "--first-parent", "--reverse", `${base}..${main}`).split("\n").filter(Boolean);
  const out: Replayed = { commit, pr, named, landed: landed.length, git: [], ours: [] };
  for (const p of landed) {
    const files = [...changed(`${p}^`, p)].filter((f) => mine.has(f)).sort();
    const by = { git: [] as string[], ours: [] as string[] };
    for (const f of files) {
      const was = show(base, f), mid = show(`${p}^`, f), now = show(p, f), b = show(branch, f);
      if (gitMerge(was, mid, b).clean && !gitMerge(was, now, b).clean) by.git.push(f);
      if (lineMerge(f, was, mid, b).clean && !lineMerge(f, was, now, b).clean) by.ours.push(f);
    }
    const who = prOf(git("log", "-1", "--format=%s", p));
    if (by.git.length) out.git.push({ pr: who, commit: p.slice(0, 7), files: by.git });
    if (by.ours.length) out.ours.push({ pr: who, commit: p.slice(0, 7), files: by.ours });
  }
  return out;
}

/** The waves each merge test gives the replayed PRs and their blockers, in the order they landed. */
export function plans(rs: Replayed[]) {
  const name = (pr: number | undefined, commit: string) => pr ? `#${pr}` : commit;
  const plan = (which: "git" | "ours") => {
    const clashes: Clash[] = rs.flatMap((r) => r[which].map((b) => ({ first: name(b.pr, b.commit), then: name(r.pr, r.commit), files: b.files })));
    // Blockers landed first; the waiting PRs land in the order their fixes were made.
    const order = [...new Set([...clashes.map((c) => c.first), ...rs.map((r) => name(r.pr, r.commit))])];
    return waves(order, clashes).map((w) => w.map((p) => p.branch));
  };
  return { git: plan("git"), ours: plan("ours") };
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const cases = args.length ? args.map((commit) => ({ commit, pr: undefined as number | undefined, blocker: undefined as number | undefined })) : CASES;
  const out = cases.map((c) => replay(c.commit, c.pr, "blocker" in c ? c.blocker : undefined));
  if (process.argv.includes("--json")) console.log(JSON.stringify({ replays: out, waves: plans(out) }, null, 2));
  else {
    const list = (bs: Blocker[]) => bs.length ? bs.map((b) => `${b.pr ? `#${b.pr}` : b.commit} (${b.files.join(", ")})`).join("; ") : "none";
    let held = 0, freed = 0, missed = 0;
    for (const r of out) {
      held += +!!r.git.length; freed += +(!!r.git.length && !r.ours.length);
      if (r.named && !r.git.some((b) => b.pr === r.named)) missed++;
      console.log(`${r.pr ? `#${r.pr} ` : ""}${r.commit}: ${r.landed} PRs landed meanwhile${r.named ? `, the fix names #${r.named}` : ""}`);
      console.log(`  git:          ${list(r.git)}`);
      console.log(`  codeSplitter: ${list(r.ours)}`);
    }
    const w = plans(out), show = (ws: string[][]) => ws.map((x, i) => `${i + 1}: ${x.join(" ")}`).join("\n  ");
    console.log(`\nwaves by git's merge:\n  ${show(w.git)}\nwaves by codeSplitter's:\n  ${show(w.ours)}`);
    console.log(`\n${out.length} fixes: git's merge puts ${held} behind a blocker${missed ? ` (${missed} missed the one its fix names)` : ""}; codeSplitter's frees ${freed} of them`);
  }
}
