// Lands PRs that must wait for others (#5344). Preflight (scripts/preflight.ts) prints a `Merge after #12, #34` line for
// the PR body when other open PRs change the same files. Each pass reads every open PR with that line; once every PR it
// names has merged (or closed), it merges `main` into the branch and pushes, so the branch is current with what it
// waited on and CI runs on the result. The line then reads `Merged main in after #12, #34`, so the next pass skips it.
// When git's merge of main conflicts, each conflicted file goes through Mervin's line merge (`lineMerge` in
// apps/codesplitter/scripts/shadow.ts, loaded at run time since it needs the packages installed). When he settles every
// file it commits, pushes and names them in a comment. Otherwise (a card: a person must choose) it pushes nothing,
// comments on the PR with each file and Mervin's cards and tags its author, and the line reads `Main conflicts after #12, #34`.
//
//   bun scripts/after.ts [--dry]
//
// Runs in after.yml on every push to main and hourly, in a checkout with full history. Forks are skipped (no push).
// `--dry` says what it would do and changes nothing.
//
// Without the AFTER_TOKEN secret (after.yml sets HAS_AFTER_TOKEN, never the value) its push is made with the workflow's
// own token, which starts no checks (#5733). Then it comments on the PR with the one command that starts them and
// prints a `::warning::` line so the run summary shows it.
//
// A PR that Claude Code's `/ship` or `/steward` watch, or the cloud PR Steward, holds (a `claude-pr-steward-*` or
// `claude-ship-*` label) is left alone: that watch merges main in and pushes itself, and two pushers race. Its line
// stays as it is, so a pass after the label goes picks it up.
//
// A push made with the workflow's own token starts no checks (#5733), so every pass also looks at each PR whose line
// reads `Merged main in after` and whose head is still the bot's commit (#5837). Once that head is CHECK_AFTER old with
// no typecheck or apps run on Actions (a queued one counts), it starts CI: with AFTER_TOKEN set (after.yml passes
// HAS_AFTER_TOKEN=true, never the value) it pushes one empty `Start CI` commit, which a token push does start; without
// it, it comments once per head with the one-push fix (an `<!-- after:unchecked <sha> -->` marker) and prints a
// `::warning::` line. A head someone else pushed is theirs, and it stops looking. After a pass that pushed, it waits
// FOLLOW_UP and checks again, so a miss shows in minutes rather than at the next hourly run.
//
// A blocker (one test red on PR after PR, a `ci-blocker` issue: apps/agent-office/ester/blockers.ts) held its PRs red
// until its fix landed. Once its issue closes (the fix's `Fixes #N` closes it), each open PR it names gets main merged
// in the same way, so its checks rerun on the fix, and a `<!-- after:unblocked #N -->` comment so it happens once.
// Issues closed more than UNBLOCK_DAYS ago are left alone. Merging then goes on in each PR's `Merge after` order as it
// goes green, as before.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { arr, bool, check, int, obj, str, type Of } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";
import { AFTER_BOT, RUN_FIELDS, Runs, headRuns } from "./pr.ts";
import { BLOCKER_LABEL, blockerOf } from "../apps/agent-office/ester/blockers.ts";

/** One row of `gh pr list --json number,headRefName,body,author,isCrossRepository,labels`. */
export const AfterPr = obj({
  number: int(1, Infinity), headRefName: str(Infinity), body: str(Infinity, { min: 0 }),
  author: obj({ login: str(Infinity) }), isCrossRepository: bool(), labels: arr(obj({ name: str(Infinity) }), Infinity),
});
export type AfterPr = Of<typeof AfterPr>;
export type PrState = "OPEN" | "MERGED" | "CLOSED";

/** `gh pr view --json headRefOid,commits,comments`: the head, who made its last commit and when, and the comments' text. */
export const Head = obj({
  headRefOid: str(64),
  commits: arr(obj({ committedDate: str(40), messageHeadline: str(Infinity, { min: 0, dflt: "" }), authors: arr(obj({ name: str(200, { min: 0, dflt: "" }) }), 50, { drop: true }) }), Infinity, { drop: true }),
  comments: arr(obj({ body: str(Infinity, { min: 0, dflt: "" }) }), Infinity, { drop: true }),
});
export type Head = Of<typeof Head>;

/** What a pass needs from GitHub; `ghCli` is the real one, tests pass their own. */
export interface Gh {
  open(): AfterPr[];
  state(n: number): PrState;
  comment(n: number, text: string): void;
  setBody(n: number, body: string): void;
  head(n: number): Head;
  /** The workflow runs on a SHA, queued ones included. */
  runs(sha: string): Runs;
  /** The blocker issues closed lately (`gh issue list --label ci-blocker --state closed`). */
  closedBlockers(): ClosedIssue[];
}

/** One closed blocker issue: its number, body (the blocker record) and when it closed. */
export const ClosedIssue = obj({ number: int(1, Infinity), body: str(Infinity, { min: 0 }), closedAt: str(40) });
export type ClosedIssue = Of<typeof ClosedIssue>;
/** How long after a blocker's issue closes its held PRs still get main merged in. */
export const UNBLOCK_DAYS = 3;
const unblockMark = (issue: number) => `<!-- after:unblocked #${issue} -->`;

/** How long a bot head may sit with no CI run before a pass starts it or flags it, and how long after its own push a pass looks again. */
export const CHECK_AFTER = 300, FOLLOW_UP = 180;
/** The empty commit that starts CI on a bot head (`bun run kick` writes the same one). */
export const KICK_MESSAGE = "Start CI (after-bot push started no checks)";
const MERGED_LINE = /^merged main in after #\d+/im;
const flagMark = (sha: string) => `<!-- after:unchecked ${sha} -->`;

/** `lineMerge`: Mervin's, which settles git's conflicts; without it every conflict goes to a person. */
export interface PassOpts { dry?: boolean; token?: boolean; now?: number; checkAfter?: number; lineMerge?: LineMerge | null }

/** A `Merged main in after` PR whose head is still the bot's: has it CI, and if not, start it (token) or flag it once (no token). Null when the head is someone else's. */
function ciCheck(gh: Gh, git: Git, pr: AfterPr, o: Required<PassOpts>): string | null {
  const h = gh.head(pr.number), last = h.commits.at(-1);
  if (!last || !last.authors.some((a) => a.name === AFTER_BOT)) return null;
  const sha = h.headRefOid, short = sha.slice(0, 7), tag = `#${pr.number} head ${short}`;
  if (headRuns(gh.runs(sha)) !== "none") return `${tag} has CI`;
  const age = Math.round((o.now - Date.parse(last.committedDate)) / 1000);
  if (age < o.checkAfter) return `${tag} has no CI run yet (${Math.round(age / 60)} min old)`;
  const mins = Math.round(age / 60);
  // A token push of our own empty commit that still got no run: pushing again won't help, so say so.
  if (o.token && last.messageHeadline !== KICK_MESSAGE) {
    if (o.dry) return `${tag} has no CI after ${mins} min: would start CI`;
    const got = git("fetch", "-q", "origin", pr.headRefName);
    if (got.code !== 0) throw new Error(`git fetch: ${got.out.trim()}`);
    const at = git("rev-parse", `origin/${pr.headRefName}`).out.trim();
    if (at !== sha) return `${tag} moved on (${at.slice(0, 7)}): someone else pushed`;
    const made = git("commit-tree", `${sha}^{tree}`, "-p", sha, "-m", KICK_MESSAGE);
    if (made.code !== 0) throw new Error(`git commit-tree: ${made.out.trim()}`);
    const kick = made.out.trim(), pushed = git("push", "-q", "origin", `${kick}:refs/heads/${pr.headRefName}`);
    if (pushed.code !== 0) throw new Error(`git push: ${pushed.out.trim()}`);
    return `${tag} had no CI after ${mins} min: started CI (pushed ${kick.slice(0, 7)})`;
  }
  const warn = `::warning::#${pr.number} head ${short} (the after workflow's merge of main) has had no typecheck or apps run for ${mins} min`;
  if (h.comments.some((c) => c.body.includes(flagMark(sha)))) return `${tag} has no CI after ${mins} min: already flagged\n${warn}`;
  if (o.dry) return `${tag} has no CI after ${mins} min: would flag it`;
  gh.comment(pr.number, `${flagMark(sha)}\nNo typecheck or apps run started on ${short}, the after workflow's merge of main: a push made with the workflow's own token starts no checks (#5733). One push of your own starts them: \`bun run kick ${pr.number}\`, or\n\n\`\`\`\ngit fetch origin && git checkout -B ${pr.headRefName} origin/${pr.headRefName} && git commit --allow-empty -m "Start CI" && git push origin ${pr.headRefName}\n\`\`\``);
  return `${tag} has no CI after ${mins} min: flagged\n${warn}`;
}

/** Runs git in the checkout: exit code and output. */
export type Git = (...args: string[]) => { code: number; out: string };

/** The labels a Claude Code watch or the cloud PR Steward puts on a PR it holds. */
export const WATCHED = /^claude-(?:pr-steward|ship)-/;

const LINE = /^merge after (#\d+(?:(?:,\s*|\s+and\s+|\s+)#\d+)*)/im;

/** The PRs a body says to merge after, from its `Merge after #N` line (none without one). */
export function blockers(body: string): number[] {
  const m = body.match(LINE);
  return m ? [...m[1]!.matchAll(/#(\d+)/g)].map((x) => Number(x[1])) : [];
}

/** The body with its `Merge after` line's words swapped for `to` (the PR numbers stay). */
export const marked = (body: string, to: string) => body.replace(LINE, (all) => all.replace(/^merge after/i, to));

/** What a PR is told when the runner's push starts no checks (#5733). */
export const NO_CHECKS = 'main is merged in, but this push starts no checks (#5733). Push one commit of your own on top: `git commit --allow-empty -m "Start CI" && git push`';

/**
 * Mervin's line merge of one file (`lineMerge` in apps/codesplitter/scripts/shadow.ts): clean with its text, or the
 * cards he left. Passed in rather than imported, since it needs the repo's packages installed (the CLI loads it).
 */
export type LineMerge = (path: string, base: string, main: string, branch: string, attributes?: string) =>
  { clean: boolean; text: string | null; conflicts: { lint?: string }[] };

/** What one conflicted file came to: Mervin's clean text, or why a person must choose in it. */
type Settled = { f: string; text: string } | { f: string; text: null; why: string };
/** The file a card line (`` `path`: why ``) is about. */
const fileOf = (line: string) => line.slice(1, line.indexOf("`", 1));

/** One pass over the open PRs; answers one line per PR it looked at. `token`: pushes run CI (AFTER_TOKEN is set). */
export function pass(gh: Gh, git: Git, opts: PassOpts = {}): string[] {
  const o: Required<PassOpts> = { dry: false, token: false, now: Date.now(), checkAfter: CHECK_AFTER, lineMerge: null, ...opts }, { dry, token } = o;
  const out: string[] = [];
  const must = (...a: string[]) => {
    const r = git(...a);
    if (r.code !== 0) throw new Error(`git ${a.join(" ")}: ${r.out.trim()}`);
    return r.out;
  };
  const prs = gh.open();
  for (const pr of prs) {
    const after = blockers(pr.body), merged = !after.length && MERGED_LINE.test(pr.body);
    if (!after.length && !merged) continue;
    const held = pr.labels.find((l) => WATCHED.test(l.name));
    if (held) { if (!merged) out.push(`#${pr.number} skipped: a Claude watch holds it (${held.name}) and merges main in itself`); continue; }
    if (pr.isCrossRepository) { if (!merged) out.push(`#${pr.number} skipped: a fork's branch can't be pushed to`); continue; }
    if (merged) {
      try { const line = ciCheck(gh, git, pr, o); if (line) out.push(line); }
      catch (e) { out.push(`#${pr.number} CI check failed: ${e instanceof Error ? e.message : String(e)}`); }
      continue;
    }
    const waiting = after.filter((n) => gh.state(n) === "OPEN");
    if (waiting.length) { out.push(`#${pr.number} waits on ${waiting.map((n) => `#${n}`).join(", ")}`); continue; }
    if (dry) { out.push(`#${pr.number} would merge main in`); continue; }
    const named = after.map((n) => `#${n}`).join(", ");
    try {
      const { conflicts: files, settled } = mergeMain(pr, named);
      if (!files.length) {
        gh.setBody(pr.number, marked(pr.body, "Merged main in after"));
        pushed(pr, settled, settled ? " (settled its conflicts)" : "");
      } else {
        gh.comment(pr.number, `@${pr.author.login} ${named} landed, and main no longer merges clean into this branch, not even through Mervin's line merge. A person must choose in:\n\n${files.map((f) => `- ${f}`).join("\n")}\n\nMerge main in (or rebase) and push; the runner (scripts/after.ts) won't try again.`);
        gh.setBody(pr.number, marked(pr.body, "Main conflicts after"));
        out.push(`#${pr.number} conflicts with main in ${files.map(fileOf).join(", ")}: commented`);
      }
    } catch (e) { out.push(`#${pr.number} failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  // A blocker's fix landed (its issue closed): the PRs it held get main merged in, so their checks rerun on the fix.
  const open = new Map(prs.map((p) => [p.number, p]));
  for (const issue of gh.closedBlockers()) {
    if (o.now - Date.parse(issue.closedAt) > UNBLOCK_DAYS * 86_400_000) continue;
    const b = blockerOf(issue);
    for (const n of b?.prs ?? []) {
      const pr = open.get(n);
      if (!pr) continue;
      const held = pr.labels.find((l) => WATCHED.test(l.name));
      if (held) { out.push(`#${n} skipped: a Claude watch holds it (${held.name}) and merges main in itself`); continue; }
      if (pr.isCrossRepository) continue;
      try {
        if (gh.head(n).comments.some((c) => c.body.includes(unblockMark(issue.number)))) continue;
        if (dry) { out.push(`#${n} would merge main in: blocker #${issue.number} is fixed`); continue; }
        const { conflicts: files, settled } = mergeMain(pr, `the fix for #${issue.number}`);
        if (!files.length) pushed(pr, `${unblockMark(issue.number)}\nThe test that held this PR red (${b!.test}) is fixed on main (#${issue.number} closed), so main is merged in and its checks rerun on the fix.${settled ? `\n\n${settled}` : ""}`, ` after blocker #${issue.number}`);
        else {
          gh.comment(pr.number, `${unblockMark(issue.number)}\n@${pr.author.login} the test that held this PR red is fixed on main (#${issue.number}), but main no longer merges clean into this branch, not even through Mervin's line merge. A person must choose in:\n\n${files.map((f) => `- ${f}`).join("\n")}\n\nMerge main in (or rebase) and push.`);
          out.push(`#${n} conflicts with main in ${files.map(fileOf).join(", ")} after blocker #${issue.number}: commented`);
        }
      } catch (e) { out.push(`#${n} failed: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }
  return out;

  /**
   * Merges main into the PR's branch and pushes. `conflicts`: the files a person must choose in (nothing pushed).
   * Otherwise pushed, and `settled` names each conflicted file `settle` resolved and how (one line each, for the comment).
   */
  function mergeMain(pr: AfterPr, why: string): { conflicts: string[]; settled: string } {
    must("fetch", "-q", "origin", "main", pr.headRefName);
    must("checkout", "-q", "-B", `after-${pr.number}`, `origin/${pr.headRefName}`);
    if (git("merge", "--no-edit", "-m", `Merge main into ${pr.headRefName} (after ${why} landed)`, "origin/main").code === 0) {
      must("push", "-q", "origin", `HEAD:${pr.headRefName}`);
      return { conflicts: [], settled: "" };
    }
    const files = must("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
    const done = files.map((f) => mervin(f));
    if (done.some((d) => d.text === null)) {
      git("merge", "--abort");
      return { conflicts: done.map((d) => d.text === null ? `\`${d.f}\`: ${d.why}` : `\`${d.f}\`: Mervin settled it`), settled: "" };
    }
    const root = must("rev-parse", "--show-toplevel").trim();
    for (const { f, text } of done) { writeFileSync(join(root, f), text!); must("add", "--", f); }
    must("commit", "-q", "--no-edit");
    must("push", "-q", "origin", `HEAD:${pr.headRefName}`);
    return { conflicts: [], settled: `git's merge of main conflicted, and Mervin's line merge (apps/codesplitter/scripts/shadow.ts) settled every file:\n\n${files.map((f) => `- \`${f}\``).join("\n")}` };
  }
  /** One conflicted file through Mervin's line merge, from the index's three stages (1 base, 2 the branch, 3 main). */
  function mervin(f: string): Settled {
    if (!o.lineMerge) return { f, text: null, why: "Mervin's line merge didn't load (are the packages installed?)" };
    const stage = (n: number) => { const r = git("show", `:${n}:${f}`); return r.code === 0 ? r.out : null; };
    const [base, branch, main] = [stage(1), stage(2), stage(3)];
    if (base === null || branch === null || main === null) return { f, text: null, why: "one side added or deleted it" };
    if ([base, branch, main].some((s) => s.includes("\0"))) return { f, text: null, why: "a binary file" };
    const attrs = git("show", "origin/main:.gitattributes");
    const r = o.lineMerge(f, base, main, branch, attrs.code === 0 ? attrs.out : "");
    if (r.clean && r.text !== null) return { f, text: r.text };
    const lint = r.conflicts.flatMap((c) => c.lint ? [c.lint] : []);
    return { f, text: null, why: `Mervin left ${r.conflicts.length} card${r.conflicts.length === 1 ? "" : "s"}${lint.length ? ` (${[...new Set(lint)].join("; ")})` : ""}` };
  }
  /** Says a push happened: with the token its checks run; without, one comment with the fix (and `note`, if any). */
  function pushed(pr: AfterPr, note: string, tail = "") {
    if (token) {
      if (note) gh.comment(pr.number, note);
      out.push(`#${pr.number} merged main in and pushed${tail}`);
      return;
    }
    gh.comment(pr.number, `${note ? `${note}\n\n` : ""}${NO_CHECKS}\n\n${flagMark(must("rev-parse", "HEAD").trim())}`);
    out.push(`::warning::#${pr.number} merged main in and pushed${tail}, but the push starts no checks without AFTER_TOKEN (#5733): commented`);
  }
}

export const sh = (cmd: string[], stdin?: string) => {
  const r = Bun.spawnSync(cmd, { stdin: stdin === undefined ? "ignore" : Buffer.from(stdin), stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};
const ghRun = (args: string[], stdin?: string) => {
  const r = sh(["gh", ...args], stdin);
  if (r.code !== 0) throw new Error(`gh ${args.join(" ")}: ${r.out.trim()}`);
  return r.out;
};

export const ghCli: Gh = {
  open: () => arr(AfterPr, Infinity)(JSON.parse(ghRun(["pr", "list", "--state", "open", "--limit", "200", "--json", "number,headRefName,body,author,isCrossRepository,labels"]))),
  state: (n) => {
    const s = ghRun(["pr", "view", String(n), "--json", "state", "--jq", ".state"]).trim();
    return s === "MERGED" || s === "CLOSED" ? s : "OPEN";
  },
  comment: (n, text) => void ghRun(["pr", "comment", String(n), "--body-file", "-"], text),
  setBody: (n, body) => void ghRun(["pr", "edit", String(n), "--body-file", "-"], body),
  head: (n) => {
    const h = check(Head, JSON.parse(ghRun(["pr", "view", String(n), "--json", "headRefOid,commits,comments"])));
    if (!h) throw new Error(`gh pr view ${n}: not the shape expected`);
    return h;
  },
  runs: (sha) => check(Runs, JSON.parse(ghRun(["run", "list", "--commit", sha, "--json", RUN_FIELDS, "-L", "50"]))) ?? [],
  closedBlockers: () => arr(ClosedIssue, Infinity, { drop: true })(JSON.parse(ghRun(["issue", "list", "--label", BLOCKER_LABEL, "--state", "closed", "--limit", "20", "--json", "number,body,closedAt"]))),
};

if (import.meta.main) {
  help(import.meta.path);
  const git: Git = (...a) => sh(["git", ...a]);
  // Mervin's line merge needs the repo's packages (after.yml installs them). Without them the pass still runs, sending
  // every conflict to a person, but the run fails so nobody mistakes that for a healthy pass.
  let lineMerge: LineMerge | null = null;
  try { lineMerge = (await import("../apps/codesplitter/scripts/shadow.ts")).lineMerge; }
  catch (e) {
    console.log(`::error::Mervin's line merge didn't load, so conflicts go to a person (run bun install --frozen-lockfile): ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
  const opts: PassOpts = { dry: process.argv.includes("--dry"), token: process.env.HAS_AFTER_TOKEN === "true", lineMerge };
  const lines = pass(ghCli, git, opts);
  console.log(lines.length ? lines.join("\n") : "no open PR says merge after, and no fixed blocker holds one");
  // A pass that pushed looks again a few minutes on, so a head that got no CI is started or flagged now, not next hour.
  // Without the token the push already commented, and there is nothing more a pass could do.
  if (!opts.dry && opts.token && lines.some((l) => / merged main in and pushed/.test(l))) {
    await Bun.sleep(FOLLOW_UP * 1000);
    const again = pass(ghCli, git, { ...opts, checkAfter: FOLLOW_UP }).filter((l) => / head [0-9a-f]{7} /.test(l));
    if (again.length) console.log(`follow-up check:\n${again.join("\n")}`);
  }
}
