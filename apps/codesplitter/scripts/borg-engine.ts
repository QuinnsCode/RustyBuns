// The borg engine: Mervin, rolling through public git histories, forever.
//
//   bun scripts/borg-engine.ts [repo-url-or-path ...] [--dir ~/.cache/borg] [--limit 50] [--agents 4]
//                              [--commits 5] [--loop] [--every 600] [--json]
//
// One pass takes each repo in turn (cloned bare into --dir, fetched when it is already there) and:
//   1. replays the next `--limit` merges it has not seen (state.json remembers them) through the same
//      git-beside-Mervin comparison as scripts/mervin-corpus.ts, and tallies what Mervin did with each
//      file git gave up on;
//   2. keeps the HUMAN EDITS: wherever the person who merged did not land what Mervin made (Mervin asked, or
//      settled to other text), the lines they added and dropped go to lessons.jsonl with the three texts'
//      names. That file is the teaching set: what people do to a merge that no engine did for them;
//   3. with --agents, has a team of pretend agents rewrite the repo's latest `--commits` commits into one
//      file at once (scripts/borg-agents.ts), contested lines included, and counts lost updates.
//
// With --loop it sleeps `--every` seconds and goes again, so a long run walks every history back to the first
// merge. With no repos it rolls through DEFAULT_REPOS. Nothing is written to the repos; the state, the lessons
// and the clones live in --dir. The pretend agents run on the local twins: no GitHub token, no Cloudflare.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run, type Row } from "./mervin-corpus.ts";
import { local } from "../src/local.ts";
import { replayCommit } from "./borg-agents.ts";

/** Busy public repos that keep real merge commits (docs/mervin.md has what each one measured). */
export const DEFAULT_REPOS = ["https://github.com/git/git.git", "https://github.com/rails/rails.git", "https://github.com/expressjs/express.git"];

/** A human edit to a merge: the lines the person put in that Mervin's text lacks, and the lines of Mervin's they dropped. */
export interface Lesson {
  repo: string; merge: string; path: string; ext: string;
  /** What Mervin did: asked (`ours` null), or settled to text the person changed. */
  bucket: Row["bucket"]; asked: boolean;
  added: string[]; dropped: string[];
  /** How many lines the person added or dropped in all (added/dropped keep the first 12 each). */
  edited: number;
}

const KEEP = 12;

/**
 * What the person did to the merge. Compared as multisets of lines, so a reordering is no edit; when Mervin
 * asked (`ours` null) the comparison is against whichever side's text is nearer to what landed.
 */
export function humanEdit(ours: string | null, texts: { main: string; branch: string; landed: string }): { added: string[]; dropped: string[]; edited: number } {
  const count = (t: string) => { const m = new Map<string, number>(); for (const l of t.split("\n")) m.set(l, (m.get(l) ?? 0) + 1); return m; };
  const minus = (a: Map<string, number>, b: Map<string, number>) => {
    const out: string[] = [];
    for (const [l, n] of a) for (let i = 0; i < n - (b.get(l) ?? 0); i++) out.push(l);
    return out;
  };
  const landed = count(texts.landed);
  const from = ours ?? [texts.main, texts.branch].map((t) => ({ t, c: count(t) })).map((x) => ({ ...x, off: minus(landed, x.c).length + minus(x.c, landed).length })).sort((a, b) => a.off - b.off)[0]!.t;
  const was = count(from);
  const added = minus(landed, was).filter((l) => l.trim()), dropped = minus(was, landed).filter((l) => l.trim());
  return { added: added.slice(0, KEEP), dropped: dropped.slice(0, KEEP), edited: added.length + dropped.length };
}

export interface Tally { merges: number; files: number; solved: number; close: number; wrong: number; cards: number; gap: number; other: number; lessons: number }
export const noTally = (): Tally => ({ merges: 0, files: 0, solved: 0, close: 0, wrong: 0, cards: 0, gap: 0, other: 0, lessons: 0 });

interface State { seen: Record<string, string[]>; tally: Record<string, Tally> }

const git = (...a: string[]) => {
  const r = Bun.spawnSync(["git", ...a], { stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
};

/** The clone's name in --dir: `git/git`, `rails/rails`, or a path's last two parts. */
export const slugOf = (repo: string) => repo.replace(/\.git\/?$/, "").split(/[/:]/).filter(Boolean).slice(-2).join("--");

/** Clone bare on first sight, fetch after. A path that is already a repo is used in place. */
export function checkout(repo: string, dir: string): string {
  if (existsSync(join(repo, ".git")) || existsSync(join(repo, "HEAD"))) return repo;
  const to = join(dir, "clones", slugOf(repo) + ".git");
  if (existsSync(to)) git("-C", to, "fetch", "-q", "--prune", "origin", "+refs/heads/*:refs/heads/*");
  else { mkdirSync(join(dir, "clones"), { recursive: true }); git("clone", "-q", "--bare", repo, to); }
  return to;
}

/** One repo, one pass: the next unseen merges, their lessons, and a team's go at the latest commits. */
export async function roll(repo: string, dir: string, opts: { limit?: number; agents?: number; commits?: number; log?: (s: string) => void } = {}) {
  const log = opts.log ?? console.log;
  mkdirSync(dir, { recursive: true });
  const statePath = join(dir, "state.json");
  const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { seen: {}, tally: {} };
  const slug = slugOf(repo), clone = checkout(repo, dir);
  const seen = new Set(state.seen[slug] ?? []);
  const tally = state.tally[slug] ??= noTally();
  const fresh: string[] = [];
  let lessons = 0;

  const { fought, rows } = run(clone, opts.limit ?? 50, 3000, {
    skip: (c) => seen.has(c),
    done: (c) => { fresh.push(c); },
    each: (row, t) => {
      // The human edits are the fights: git gave up, and either Mervin asked or the person changed what he made.
      if (!["wrong", "close", "cards", "guard", "gap"].includes(row.bucket)) return;
      const e = humanEdit(t.ours, t);
      if (!e.edited && row.bucket !== "gap") return;
      const lesson: Lesson = { repo: slug, merge: row.merge, path: row.path, ext: row.ext, bucket: row.bucket, asked: t.ours === null, ...e };
      appendFileSync(join(dir, "lessons.jsonl"), JSON.stringify(lesson) + "\n");
      lessons++;
    },
  });
  for (const c of fresh) seen.add(c);
  state.seen[slug] = [...seen];
  tally.merges += fresh.length;
  tally.files += rows.length;
  tally.lessons += lessons;
  for (const r of rows) {
    if (r.bucket === "solved" || r.bucket === "close" || r.bucket === "wrong" || r.bucket === "cards" || r.bucket === "gap") tally[r.bucket]++;
    else tally.other++;
  }
  writeFileSync(statePath, JSON.stringify(state));
  const n = (b: Row["bucket"]) => rows.filter((r) => r.bucket === b).length;
  log(`${slug}: ${fresh.length} new merges (${fought} conflicted in git), ${rows.length} files: ${n("solved")} solved, ${n("close")} close, ${n("wrong")} wrong, ${n("cards")} cards; ${lessons} human edits kept (${seen.size} merges seen so far)`);

  let team: Awaited<ReturnType<typeof replayCommit>>[] = [];
  if (opts.agents) {
    const commits = Bun.spawnSync(["git", "-C", clone, "log", "--no-merges", `-n${opts.commits ?? 5}`, "--format=%H"]).stdout.toString().split("\n").filter(Boolean);
    const call = await local({ GH_CLI: "off" });
    try { for (const c of commits) team.push(await replayCommit(call, clone, c, { agents: opts.agents, contest: 0.3, seed: seen.size })); }
    finally { call.close(); }
    const files = team.flatMap((t) => t.files), v = (x: string) => files.filter((f) => f.verdict === x).length;
    log(`  ${opts.agents} pretend agents on ${commits.length} commits: ${files.length} files, ${v("exact")} exact, ${v("settled")} settled, ${v("lost")} lost, ${v("stuck")} stuck`);
  }
  return { slug, fresh: fresh.length, fought, rows, lessons, team };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const dir = flag("--dir") ?? join(homedir(), ".cache", "borg");
  const repos = args.filter((a, i) => !a.startsWith("--") && !["--dir", "--limit", "--agents", "--commits", "--every"].includes(args[i - 1] ?? ""));
  const roster = repos.length ? repos : DEFAULT_REPOS;
  const opts = { limit: Number(flag("--limit") ?? 50), agents: Number(flag("--agents") ?? 0), commits: Number(flag("--commits") ?? 5) };
  let bad = 0;
  do {
    for (const repo of roster) {
      try {
        const r = await roll(repo, dir, opts);
        bad += r.team.flatMap((t) => t.files).filter((f) => f.verdict === "lost" || f.verdict === "stuck").length;
      } catch (e) { console.error(`${repo}: ${(e as Error).message}`); }
    }
    if (args.includes("--json")) console.log(JSON.stringify(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).tally, null, 2));
    if (args.includes("--loop")) await Bun.sleep(Number(flag("--every") ?? 600) * 1000);
  } while (args.includes("--loop"));
  process.exit(bad ? 1 : 0);
}
