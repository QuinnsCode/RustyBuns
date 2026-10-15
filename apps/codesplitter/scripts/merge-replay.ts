// Merge replay (#1097): real "merge main into the PR branch" fixes from this
// repo's history, run end to end through a mirror and a branch merge, and
// compared with what the person who fixed each one committed. Where
// scripts/shadow.ts runs `merge()` on the three texts, this goes through the
// whole app, so a file the mirror skips, holds as a blob or lints shows here.
//
// For each merge commit (first parent the PR branch, second main):
//   1. upstream (a bare repo borrowing this clone's objects) has main at the
//      two sides' merge base and `pr` at the branch's tip;
//   2. a pull-only mirror of it opens `pr` as a branch here;
//   3. upstream's main moves to the merge's main parent, and the mirror syncs;
//   4. the branch review is a dry run of the line-id merge: each file's ops,
//      applied to main's copy, give the text it would settle, diffed against
//      the merge commit.
//
//   bun scripts/merge-replay.ts [e49e19a 14fa8c3 ...] [--recent 10] [--json]
//
// With no commits it replays the five from #1097. --recent N replays, one at a time, the newest N merge commits
// git itself conflicted on (clean merges say nothing about the engine), topped up from #1097's five when history has fewer. Everything runs in-process
// on the local twins (src/local.ts) in a temp dir: no ~/.codesplitters, no
// GitHub (GH_CLI off, no token), no Cloudflare.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { apply, empty, text, type Conflict, type Doc } from "../src/lines.ts";
import { local, type Call } from "../src/local.ts";

/** The fixes #1097 replayed: PR, and the merge commit that settled its conflicts by hand. */
export const CASES = [
  { pr: 1081, commit: "e49e19a" },
  { pr: 1066, commit: "c0487ab" },
  { pr: 1051, commit: "0e0f81e" },
  { pr: 1027, commit: "1204866" },
  { pr: 995, commit: "14fa8c3" },
];

/** How one file came out: settled like the fix (`exact`), the same lines in another order, other text, or left as cards. */
export type Outcome = "exact" | "reordered" | "differs" | "cards" | "blob" | "deleted" | "missing";
export interface FileResult { path: string; outcome: Outcome; gitConflict: boolean; cards: number; lint: string[] }
export interface Replay { commit: string; pr?: number; base: string; main: string; branch: string; gitConflicts: string[]; skipped: string[]; files: FileResult[] }

// From the clone's top, so paths match the mirror's.
const top = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"]).stdout.toString().trim();
const git = (...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd: top, stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
};
const show = (rev: string, path: string) => {
  const r = Bun.spawnSync(["git", "show", `${rev}:${path}`], { cwd: top, stderr: "pipe" });
  return r.exitCode === 0 ? r.stdout.toString() : null;
};
const sorted = (s: string) => s.split("\n").sort().join("\n");

/** The files git's own merge of the two sides conflicts on. */
function gitConflicts(main: string, branch: string) {
  const r = Bun.spawnSync(["git", "merge-tree", "--write-tree", "--name-only", "--no-messages", main, branch], { cwd: top });
  if (r.exitCode === 0) return [];
  // The tree's id, then one conflicted path per line.
  return [...new Set(r.stdout.toString().trim().split("\n").slice(1).filter(Boolean))].sort();
}

export async function replay(commit: string, pr?: number): Promise<Replay> {
  const [branch, main] = git("rev-list", "--parents", "-n1", commit).trim().split(" ").slice(1);
  if (!branch || !main) throw new Error(`${commit} isn't a merge commit`);
  const base = git("merge-base", main, branch).trim();
  const root = mkdtempSync(join(tmpdir(), "merge-replay-"));
  const up = join(root, "up.git");
  let call: Awaited<ReturnType<typeof local>> | undefined;
  try {
    // Upstream borrows this clone's objects, so pinning a branch is an update-ref, not a copy.
    git("init", "-q", "--bare", "-b", "main", up);
    writeFileSync(join(up, "objects/info/alternates"), resolve(git("rev-parse", "--git-common-dir").trim(), "objects") + "\n");
    const pin = (ref: string, sha: string) => git("--git-dir", up, "update-ref", `refs/heads/${ref}`, sha);
    pin("main", base);
    pin("pr", branch);

    call = await local({ GH_CLI: "off" });
    const ask = async (path: string, body?: unknown) => {
      const r = await call!("me", path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
      return r.json() as Promise<any>;
    };
    await ask("/api/login", { name: "me" });
    await ask("/api/mirrors", { url: `file://${up}`, name: "up", pullOnly: true });
    const opened = await ask("/api/repos/me/up/mirror/branches", { ref: "pr" });
    pin("main", main);
    const synced = await ask("/api/repos/me/up/mirror", {});
    if (synced.state !== "ok") throw new Error(`sync: ${JSON.stringify(synced)}`);

    const conflicted = gitConflicts(main, branch);
    const review = await ask("/api/repos/me/up/branches/pr");
    const files: FileResult[] = [];
    for (const f of review.files as { path: string; binary?: true; deleted?: true; ops: any[]; conflicts: Conflict[] }[]) {
      const gitConflict = conflicted.includes(f.path);
      const cards = f.conflicts.length, lint = f.conflicts.flatMap((c) => c.lint ? [c.lint] : []);
      const row = (outcome: Outcome) => files.push({ path: f.path, outcome, gitConflict, cards, lint });
      if (f.binary) { row("blob"); continue; }
      if (f.deleted) { row(show(commit, f.path) === null ? "exact" : "differs"); continue; }
      if (cards) { row("cards"); continue; }
      const landed = show(commit, f.path);
      if (landed === null) { row("missing"); continue; }
      const now = await call("me", `/api/repos/me/up/do/file?path=${encodeURIComponent(f.path)}`);
      // A file only the branch has is an empty doc on main, as the merge sees it.
      const doc: Doc = now.ok ? await now.json() as Doc : empty();
      if (!apply(doc, f.ops, "branch").ok) { row("cards"); continue; }
      const ours = text(doc);
      // git show keeps the file's last newline; a doc's text drops it.
      const want = landed.replace(/\n$/, "");
      row(ours === want ? "exact" : sorted(ours) === sorted(want) ? "reordered" : "differs");
    }
    // A file git conflicted on that the review doesn't list never reached the branch.
    for (const path of conflicted) if (!files.some((f) => f.path === path)) files.push({ path, outcome: "missing", gitConflict: true, cards: 0, lint: [] });
    return { commit, pr, base, main, branch, gitConflicts: conflicted, skipped: opened.skipped ?? [], files };
  } finally {
    call?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/** The newest `n` merge commits whose two sides git conflicts on, newest first. */
export function recent(n: number): string[] {
  const out: string[] = [];
  for (const line of git("rev-list", "--merges", "--parents", "HEAD").trim().split("\n")) {
    const [commit, a, b, ...octopus] = line.split(" ");
    if (!commit || !a || !b || octopus.length) continue;
    if (gitConflicts(b, a).length) out.push(commit);
    if (out.length === n) break;
  }
  // History may hold fewer than n; the fixes #1097 replayed top it up.
  for (const c of CASES) if (out.length < n && !out.some((o) => o.startsWith(c.commit))) out.push(c.commit);
  return out;
}

if (import.meta.main) {
  const flag = process.argv.indexOf("--recent");
  const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--recent");
  if (flag > 0) args.push(...recent(Number(process.argv[flag + 1]) || 10));
  const cases = args.length ? args.map((commit) => ({ commit, pr: undefined as number | undefined })) : CASES;
  const out: Replay[] = [];
  for (const c of cases) out.push(await replay(c.commit, c.pr));
  if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
  else {
    const t = { conflicted: 0, settled: 0, exact: 0, reordered: 0, differs: 0, cards: 0, caught: 0 };
    for (const r of out) {
      console.log(`${r.pr ? `#${r.pr} ` : ""}${r.commit}: git conflicted on ${r.gitConflicts.length}${r.skipped.length ? `, skipped ${r.skipped.join(", ")}` : ""}`);
      for (const f of r.files) {
        if (!f.gitConflict && f.outcome !== "cards") continue;
        t.conflicted += +f.gitConflict;
        if (f.outcome === "cards") { if (f.gitConflict) t.cards++; else t.caught++; }
        else if (f.gitConflict && (f.outcome === "exact" || f.outcome === "reordered" || f.outcome === "differs")) { t.settled++; t[f.outcome]++; }
        const why = f.lint.length ? ` [${f.lint.join("; ")}]` : "";
        console.log(`  ${f.path}: ${f.outcome}${f.outcome === "cards" ? ` (${f.cards})` : ""}${f.gitConflict ? "" : ", git merged it clean"}${why}`);
      }
    }
    console.log(`git conflicted on ${t.conflicted}; codeSplitter settled ${t.settled} (${t.exact} exact, ${t.reordered} reordered, ${t.differs} other text), left ${t.cards} as cards, and raised ${t.caught} git merged clean`);
  }
}
