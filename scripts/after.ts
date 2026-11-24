// Lands PRs that must wait for others (#5344). Preflight (scripts/preflight.ts) prints a `Merge after #12, #34` line for
// the PR body when other open PRs change the same files. Each pass reads every open PR with that line; once every PR it
// names has merged (or closed), it merges `main` into the branch and pushes, so the branch is current with what it
// waited on and CI runs on the result. The line then reads `Merged main in after #12, #34`, so the next pass skips it.
// When main doesn't merge clean (a card: a person must choose), it pushes nothing, comments on the PR with the files and
// tags its author, and the line reads `Main conflicts after #12, #34`.
//
//   bun scripts/after.ts [--dry]
//
// Runs in after.yml on every push to main and hourly, in a checkout with full history. Forks are skipped (no push).
// `--dry` says what it would do and changes nothing.
//
// A PR that Claude Code's `/ship` or `/steward` watch, or the cloud PR Steward, holds (a `claude-pr-steward-*` or
// `claude-ship-*` label) is left alone: that watch merges main in and pushes itself, and two pushers race. Its line
// stays as it is, so a pass after the label goes picks it up.

import { arr, bool, int, obj, str, type Of } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";

/** One row of `gh pr list --json number,headRefName,body,author,isCrossRepository,labels`. */
export const AfterPr = obj({
  number: int(1, Infinity), headRefName: str(Infinity), body: str(Infinity, { min: 0 }),
  author: obj({ login: str(Infinity) }), isCrossRepository: bool(), labels: arr(obj({ name: str(Infinity) }), Infinity),
});
export type AfterPr = Of<typeof AfterPr>;
export type PrState = "OPEN" | "MERGED" | "CLOSED";

/** What a pass needs from GitHub; `ghCli` is the real one, tests pass their own. */
export interface Gh {
  open(): AfterPr[];
  state(n: number): PrState;
  comment(n: number, text: string): void;
  setBody(n: number, body: string): void;
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

/** One pass over the open PRs; answers one line per PR it looked at. */
export function pass(gh: Gh, git: Git, dry = false): string[] {
  const out: string[] = [];
  const must = (...a: string[]) => {
    const r = git(...a);
    if (r.code !== 0) throw new Error(`git ${a.join(" ")}: ${r.out.trim()}`);
    return r.out;
  };
  for (const pr of gh.open()) {
    const after = blockers(pr.body);
    if (!after.length) continue;
    const held = pr.labels.find((l) => WATCHED.test(l.name));
    if (held) { out.push(`#${pr.number} skipped: a Claude watch holds it (${held.name}) and merges main in itself`); continue; }
    if (pr.isCrossRepository) { out.push(`#${pr.number} skipped: a fork's branch can't be pushed to`); continue; }
    const waiting = after.filter((n) => gh.state(n) === "OPEN");
    if (waiting.length) { out.push(`#${pr.number} waits on ${waiting.map((n) => `#${n}`).join(", ")}`); continue; }
    if (dry) { out.push(`#${pr.number} would merge main in`); continue; }
    const named = after.map((n) => `#${n}`).join(", ");
    try {
      must("fetch", "-q", "origin", "main", pr.headRefName);
      must("checkout", "-q", "-B", `after-${pr.number}`, `origin/${pr.headRefName}`);
      if (git("merge", "--no-edit", "-m", `Merge main into ${pr.headRefName} (after ${named} landed)`, "origin/main").code === 0) {
        must("push", "-q", "origin", `HEAD:${pr.headRefName}`);
        gh.setBody(pr.number, marked(pr.body, "Merged main in after"));
        out.push(`#${pr.number} merged main in and pushed`);
      } else {
        const files = must("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
        git("merge", "--abort");
        gh.comment(pr.number, `@${pr.author.login} ${named} landed, and main no longer merges clean into this branch. A person must choose in:\n\n${files.map((f) => `- \`${f}\``).join("\n")}\n\nMerge main in (or rebase) and push; the runner (scripts/after.ts) won't try again.`);
        gh.setBody(pr.number, marked(pr.body, "Main conflicts after"));
        out.push(`#${pr.number} conflicts with main in ${files.join(", ")}: commented`);
      }
    } catch (e) { out.push(`#${pr.number} failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return out;
}

const sh = (cmd: string[], stdin?: string) => {
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
};

if (import.meta.main) {
  help(import.meta.path);
  const lines = pass(ghCli, (...a) => sh(["git", ...a]), process.argv.includes("--dry"));
  console.log(lines.length ? lines.join("\n") : "no open PR says merge after");
}
