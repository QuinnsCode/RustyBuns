// Worktrees and stray files that workers left in .agent-office/worktrees, saved first and then cleared (#5913).
//
//   bun scripts/worktree-sweep.ts            list each stale worktree: changes, commits no remote has, its PR, its size
//   bun scripts/worktree-sweep.ts --rescue   push the work in each one that isn't on GitHub to rescue/<worktree name>
//   bun scripts/worktree-sweep.ts --remove   the owner's: re-checks every one is saved, then removes the stale worktrees
//                                            (`git worktree remove --force`, then `git worktree prune`) and stray files
//   --json                                   the survey as JSON
//
// Stale is every worktree no seated worker owns (`office-workers list`), less the one this runs from. With no answer
// from office-workers nothing is touched. A worktree holds work when it has uncommitted changes (untracked files that
// git doesn't ignore count, files only deleted don't: that's a `git worktree remove` cut off part way) or commits on
// no remote that aren't its merged PR's head. That work goes to one commit, made without touching the worktree (a
// scratch index, like `git stash create` but keeping untracked files) on top of its HEAD, so its unpushed commits come along, and is pushed to refs/heads/rescue/<name>. `--remove` takes a worktree
// only when it holds no work, or its rescue ref on origin is exactly what it holds now. Env files, `.rustybuns/` deploy
// state and node_modules are never saved (the repo is public).
//
// Strays are entries git doesn't list as worktrees: removed unless a `.git` sits in them or one level down (a
// workspace of several repositories, or a worktree git lost track of: those are listed, never removed), they changed in
// the last hour, or their name starts with a seated worker's worktree name. Sizes leave out node_modules.
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { arr, check, num, obj, opt, str } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";

export const WORKTREES = path.join(".agent-office", "worktrees");
const HOUR = 3_600_000;

export type PrState = "MERGED" | "OPEN" | "CLOSED";
export interface Pr { state: PrState; head?: string; number?: number }

export type Verdict = "skip" | "remove" | "rescue" | "keep";
export interface Entry {
  name: string;
  path: string;
  /** A git worktree of this repo (else a stray file or folder). */
  worktree: boolean;
  /** Why it stays put, when it does: seated, this session's own, a workspace, changed lately, locked. */
  hold?: string;
  branch?: string;
  head?: string;
  dirty: number;
  unpushed: number;
  pr?: Pr;
  kb: number;
  /** The commit that holds all of its work, when it holds any. */
  save?: string;
  /** What origin's rescue/<name> points at now, if anything. */
  rescued?: string;
  verdict: Verdict;
}

/** The decision table: what becomes of one entry. */
export function decide(e: Pick<Entry, "worktree" | "hold" | "dirty" | "unpushed" | "save" | "rescued">): Verdict {
  if (e.hold) return e.hold.startsWith("has a .git") ? "keep" : "skip";
  if (!e.worktree) return "remove";
  if (!e.dirty && !e.unpushed) return "remove";
  return e.save && e.rescued === e.save ? "remove" : "rescue";
}

async function git(args: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: env ? { ...process.env, ...env } : undefined });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`git ${args.slice(0, 3).join(" ")}: ${err.trim().split("\n").pop()}`);
  return out.trimEnd(); // not trim(): status lines start with a space
}
const tryGit = (args: string[], cwd: string) => git(args, cwd).catch(() => "");

/** `git worktree list --porcelain` as path, head, branch and locked. */
export function parseWorktrees(text: string) {
  return text.split("\n\n").filter(Boolean).map((block) => {
    const line = (k: string) => block.split("\n").find((l) => l === k || l.startsWith(`${k} `))?.slice(k.length + 1);
    return { path: line("worktree") ?? "", head: line("HEAD"), branch: line("branch")?.replace(/^refs\/heads\//, ""), locked: line("locked") !== undefined };
  });
}

/** Never saved to a rescue (the repo is public): env files, deploy state and the office's own files. */
export const KEEP_OUT = ["**/.env", "**/.env.*", "**/.dev.vars*", "**/.alchemy/**", "**/.rustybuns/**", "**/.agent-office/**", "**/node_modules/**"].map((g) => `:(exclude,glob)${g}`);

/**
 * The changes in a worktree that are work: `git status` less KEEP_OUT and less files only deleted from the folder.
 * A `git worktree remove` cut off part way (#5657) deletes files and leaves `.git`; every file it took is in HEAD.
 */
export async function changes(dir: string): Promise<string[]> {
  const out = await git(["status", "--porcelain", "-uall", "--", ".", ...KEEP_OUT], dir).catch(() => "");
  return out.split("\n").filter((l) => l && !l.startsWith(" D"));
}

/** One commit with everything the worktree holds: its HEAD's history plus, when it has changes, their files. */
export async function saveCommit(dir: string, name: string): Promise<string> {
  const head = await git(["rev-parse", "HEAD"], dir);
  if (!(await changes(dir)).length) return head;
  const scratch = await mkdtemp(path.join(tmpdir(), "wt-sweep-"));
  try {
    const env = { GIT_INDEX_FILE: path.join(scratch, "index") };
    // The worktree's own index, copied: its stat cache spares hashing every file again (a fresh one rehashes 10,000+).
    await copyFile(await git(["rev-parse", "--path-format=absolute", "--git-path", "index"], dir), env.GIT_INDEX_FILE).catch(() => git(["read-tree", "HEAD"], dir, env));
    await git(["add", "-A", "--", ".", ...KEEP_OUT], dir, env);
    const tree = await git(["write-tree"], dir, env);
    const who = { GIT_AUTHOR_NAME: "worktree-sweep", GIT_AUTHOR_EMAIL: "worktree-sweep@localhost", GIT_COMMITTER_NAME: "worktree-sweep", GIT_COMMITTER_EMAIL: "worktree-sweep@localhost", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
    // A fixed author and date: the same files on the same HEAD make the same commit, so --remove can tell it's saved.
    return await git(["commit-tree", tree, "-p", head, "-m", `rescue: ${name}'s uncommitted work`], dir, who);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Kilobytes on disk, node_modules left out. */
async function sizeKb(p: string): Promise<number> {
  const ignore = process.platform === "darwin" ? ["-I", "node_modules"] : ["--exclude=node_modules"];
  const proc = Bun.spawn(["du", "-sk", ...ignore, "--", p], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return Number(/^(\d+)/.exec(text)?.[1]) || 0;
}

function hasGitInside(p: string): boolean {
  if (existsSync(path.join(p, ".git"))) return true;
  try {
    return readdirSync(p, { withFileTypes: true }).some((d) => d.isDirectory() && existsSync(path.join(p, d.name, ".git")));
  } catch { return false; }
}

export interface SurveyOpts {
  /** The repository's main checkout. */
  root: string;
  /** Worktree paths (absolute or relative to root) that seated workers own. */
  seated: string[];
  /** This session's own worktree. */
  self?: string;
  /** Each branch's pull request. */
  prs: Map<string, Pr>;
  /** What origin's rescue/* refs point at, by worktree name. */
  rescues: Map<string, string>;
  now?: number;
  /** Say on stderr which entry it is on. */
  progress?: boolean;
}

/** Every entry in the worktrees folder and what becomes of it. Reads only. */
export async function survey(o: SurveyOpts): Promise<Entry[]> {
  const base = path.join(o.root, WORKTREES);
  const real = (p: string) => { const abs = path.resolve(o.root, p); try { return realpathSync(abs); } catch { return abs; } };
  if (!existsSync(base)) return [];
  const seated = new Set(o.seated.map(real));
  const seatedNames = [...seated].map((p) => path.basename(p));
  const self = o.self ? real(o.self) : undefined;
  const trees = new Map(parseWorktrees(await git(["worktree", "list", "--porcelain"], o.root)).map((w) => [w.path, w]));
  const now = o.now ?? Date.now();
  const out: Entry[] = [];
  const names = readdirSync(base).sort();
  for (const [i, name] of names.entries()) {
    if (o.progress) process.stderr.write(`\r${i + 1}/${names.length} ${name}`.padEnd(60));
    const p = path.join(base, name);
    const rp = real(p);
    const wt = trees.get(rp);
    const e: Entry = { name, path: p, worktree: !!wt, dirty: 0, unpushed: 0, kb: 0, verdict: "skip" };
    if (seated.has(rp)) e.hold = "seated";
    else if (self && (rp === self || self.startsWith(`${rp}/`))) e.hold = "this session's own";
    else if (wt?.locked) e.hold = "locked";
    else if (!wt) {
      if (hasGitInside(p)) e.hold = "has a .git but git doesn't list it (a workspace, or a lost worktree)";
      else if (now - lstatSync(p).mtimeMs < HOUR) e.hold = "changed in the last hour";
      else if (seatedNames.some((s) => name.startsWith(s))) e.hold = "named after a seated worker";
    }
    if (wt && !e.hold) {
      e.branch = wt.branch;
      e.head = wt.head;
      e.dirty = (await changes(p)).length;
      e.pr = wt.branch ? o.prs.get(wt.branch) : undefined;
      // A merged PR's head is delivered even once GitHub deleted the branch (squash merges leave it on no remote).
      const landed = e.pr?.head && (await tryGit(["cat-file", "-t", e.pr.head], p)) === "commit" ? [e.pr.head] : [];
      e.unpushed = Number(await tryGit(["rev-list", "--count", "HEAD", "--not", "--remotes", ...landed], p)) || 0;
      if (e.dirty || e.unpushed) e.save = await saveCommit(p, name).catch(() => undefined);
      e.rescued = o.rescues.get(name);
    }
    if (!e.hold || e.hold.startsWith("has a .git")) e.kb = await sizeKb(p);
    e.verdict = decide(e);
    out.push(e);
  }
  return out;
}

/** Pushes each `rescue` entry's save commit to origin's rescue/<name>. Returns the names saved and any that failed. */
export async function rescue(root: string, entries: Entry[], remote = "origin") {
  const saved: string[] = [];
  const failed: string[] = [];
  for (const e of entries) {
    if (e.verdict !== "rescue") continue;
    if (!e.save) { failed.push(`${e.name}: couldn't make its save commit`); continue; }
    try {
      await git(["push", "--quiet", remote, `${e.save}:refs/heads/rescue/${e.name}`, ...(e.rescued ? ["--force-with-lease=" + `refs/heads/rescue/${e.name}:${e.rescued}`] : [])], e.path);
      e.rescued = e.save;
      e.verdict = decide(e);
      saved.push(e.name);
    } catch (err) {
      failed.push(`${e.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { saved, failed };
}

/** Removes every `remove` entry: worktrees through git, then strays. Returns the names removed. */
export async function removeAll(root: string, entries: Entry[]): Promise<string[]> {
  const gone: string[] = [];
  for (const e of entries.filter((x) => x.verdict === "remove")) {
    try {
      if (e.worktree) await git(["worktree", "remove", "--force", "--force", e.path], root);
      else rmSync(e.path, { recursive: true, force: true });
      gone.push(e.name);
    } catch (err) {
      console.log(`  could not remove ${e.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await tryGit(["worktree", "prune"], root);
  return gone;
}

// --- reading the office and GitHub -----------------------------------------------------------------------------------

const Workers = obj({ workers: arr(obj({ worktree: opt(obj({ path: opt(str(4096)) })) }), 1000) });
const Prs = arr(obj({ headRefName: str(1000), state: str(20), headRefOid: opt(str(64)), number: opt(num(0, 1e9)) }), 20_000);

async function out(cmd: string[], cwd: string): Promise<string | undefined> {
  try {
    const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "ignore" });
    const t = await new Response(p.stdout).text();
    return (await p.exited) === 0 ? t : undefined;
  } catch { return undefined; }
}

/** The worktrees seated workers own, or undefined when the office can't be asked. */
export async function seatedPaths(root: string): Promise<string[] | undefined> {
  const text = await out(["office-workers", "list", "--json"], root);
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { return undefined; }
  const w = check(Workers, parsed);
  return w ? w.workers.flatMap((x) => (x.worktree?.path ? [x.worktree.path] : [])) : undefined;
}

const RANK: Record<PrState, number> = { MERGED: 3, OPEN: 2, CLOSED: 1 };
/** Each branch's PR (merged before open before closed), from GitHub, or undefined when gh can't answer. */
export async function prsByBranch(root: string): Promise<Map<string, Pr> | undefined> {
  const text = await out(["gh", "pr", "list", "--state", "all", "--limit", "5000", "--json", "headRefName,state,headRefOid,number"], root);
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { return undefined; }
  const list = check(Prs, parsed);
  if (!list) return undefined;
  const m = new Map<string, Pr>();
  for (const p of list) {
    const state = p.state === "MERGED" || p.state === "OPEN" || p.state === "CLOSED" ? p.state : undefined;
    if (!state) continue;
    const had = m.get(p.headRefName);
    if (!had || RANK[state] > RANK[had.state]) m.set(p.headRefName, { state, head: p.headRefOid, number: p.number });
  }
  return m;
}

/** origin's rescue/* refs by worktree name. */
export async function rescueRefs(root: string, remote = "origin"): Promise<Map<string, string>> {
  const text = await tryGit(["ls-remote", remote, "refs/heads/rescue/*"], root);
  return new Map(text.split("\n").filter(Boolean).map((l) => {
    const [sha, ref] = l.split("\t");
    return [ref!.replace("refs/heads/rescue/", ""), sha!];
  }));
}

const gb = (kb: number) => `${(kb / 1024 / 1024).toFixed(1)} GB`;
const mb = (kb: number) => `${Math.round(kb / 1024)} MB`;

function report(entries: Entry[]) {
  const trees = entries.filter((e) => e.worktree && !e.hold);
  console.log("worktree".padEnd(28), "changes", "unpushed", "PR".padEnd(14), "size".padStart(8), " then");
  for (const e of trees) {
    const pr = e.pr ? `#${e.pr.number ?? "?"} ${e.pr.state.toLowerCase()}` : "none";
    console.log(e.name.padEnd(28), (e.dirty ? `y ${e.dirty}` : "n").padEnd(7), String(e.unpushed).padEnd(8), pr.padEnd(14), mb(e.kb).padStart(8), "", e.verdict === "rescue" ? "rescue, then remove" : e.verdict);
  }
  const strays = entries.filter((e) => !e.worktree && !e.hold);
  if (strays.length) console.log(`\n${strays.length} stray entries (not worktrees), ${mb(strays.reduce((n, e) => n + e.kb, 0))}: ${strays.map((e) => e.name).join(", ")}`);
  const held = entries.filter((e) => e.hold);
  if (held.length) console.log(`\nleft alone: ${held.map((e) => `${e.name} (${e.hold})`).join(", ")}`);
  const go = entries.filter((e) => e.verdict === "remove" || e.verdict === "rescue");
  console.log(`\n${trees.length} stale worktrees, ${strays.length} strays, ${held.length} left alone; ${trees.filter((e) => e.verdict === "rescue").length} need a rescue first; ${gb(go.reduce((n, e) => n + e.kb, 0))} to free (node_modules not counted)`);
}

if (import.meta.main) {
  help(import.meta.path);
  const argv = process.argv.slice(2);
  const cwd = process.cwd();
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  const root = path.dirname(common);
  const self = await tryGit(["rev-parse", "--show-toplevel"], cwd);
  const [seated, prs] = await Promise.all([seatedPaths(root), prsByBranch(root)]);
  if (!seated) { console.log("office-workers list didn't answer: without who is seated, nothing is touched."); process.exit(1); }
  if (!prs) { console.log("gh pr list didn't answer: without the PRs, nothing is touched."); process.exit(1); }
  const entries = await survey({ root, seated, self: self || undefined, prs, rescues: await rescueRefs(root), progress: process.stderr.isTTY || argv.includes("--progress") });
  if (argv.includes("--json")) { console.log(JSON.stringify(entries, null, 2)); process.exit(0); }
  if (argv.includes("--rescue")) {
    const { saved, failed } = await rescue(root, entries);
    console.log(`rescued ${saved.length}: ${saved.map((n) => `rescue/${n}`).join(", ") || "none"}`);
    for (const f of failed) console.log(`  not rescued: ${f}`);
  }
  if (argv.includes("--remove")) {
    const unsaved = entries.filter((e) => e.verdict === "rescue");
    for (const e of unsaved) console.log(`  kept ${e.name}: its work isn't on origin's rescue/${e.name} (run --rescue)`);
    const gone = await removeAll(root, entries);
    console.log(`removed ${gone.length}; ${unsaved.length} kept unsaved, ${entries.filter((e) => e.hold).length} left alone`);
  } else {
    report(entries);
    const unsaved = entries.filter((e) => e.verdict === "rescue").length;
    console.log(unsaved ? `\n${unsaved} still need --rescue before --remove takes them.` : "\nThe owner's one line: bun scripts/worktree-sweep.ts --remove");
  }
}
