// Shadow mode (#1014): codeSplitter's line-id merge run beside git's on PRs
// that already merged, from local git history alone. Each merge a PR made is
// replayed with the versions git saw: its squash onto main (main just before
// it, the PR's head) and each time the branch took main in on the way, each
// from the two sides' merge base. Every file both sides changed goes through
// `git merge-file` and through `merge()` + `lintMerge()` as a branch merge
// does (src/branches.ts), and each disagreement is printed:
//
//   git-only  git conflicts, codeSplitter merges clean
//   ours-only codeSplitter conflicts, git merges clean: a resolver gap, like
//             the ones measured in docs/merge-solutions.md
//   differ    both clean, different text
//   guard     a guard tripped: markers, data that won't parse, lint
//   lock      a lockfile both changed: a conflict by design (keep a side,
//             regenerate), so listed but not a gap
//   both      both conflict (agree: the same clean text, not listed)
//
// Each clean result is also checked against what landed on main: the PR's own
// resolution, which a person or agent made and CI passed.
//
//   bun scripts/shadow.ts [--limit 1000] [--pr 893,886] [--json] [--check]
//
// `--check` (#1043, needs `--pr`: an install per merge) builds and tests each
// merge with git-only files: git's merge of the two sides (merge-tree), ours
// written in for every git-only file and what landed for any other conflict,
// then `bun install` and the touched apps' tests as the tree's own
// scripts/ci-apps.ts ran them. If anything fails, what landed is tested too,
// and only the tests that fail on ours and pass there count (`fail`); failing
// on both (`same`) is the sandbox or a native build, not the merge.
// Tests run in a throwaway folder with an empty HOME and none of this shell's
// env, so nothing reaches a live account.
//
// The PR list (number, head, merge commit) comes from `gh pr list`, read only;
// `--from prs.json` reads the same fields from a file instead. A PR whose head
// isn't in the local clone is skipped and counted. Each disagreement becomes a
// fixture in test/conflicts.test.ts or a fix issue.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { apply, empty, fromText, merge, text, type Conflict, type Doc } from "../src/lines.ts";
import { diffToOps } from "../src/sync.ts";
import { lintMerge } from "../src/lint.ts";
import { policyOf } from "../src/policy.ts";

export type Verdict = "agree" | "both" | "git-only" | "ours-only" | "differ" | "guard" | "lock";
export interface Shadow {
  verdict: Verdict;
  git: { clean: boolean; text: string };
  ours: { clean: boolean; text: string | null; conflicts: Conflict[] };
  /**
   * Whether each clean result is what landed on main (the PR's own resolution),
   * when that's known, how many lines of ours it changed (`off`), and whether
   * it only put ours's lines in another order (`reordered`: both sides' new
   * tests or rows, the other one first).
   */
  landed?: { git: boolean; ours: boolean; off: number; reordered: boolean };
}

/** Both merges of one file, from its three versions as text. */
export function shadow(path: string, base: string, main: string, branch: string, attributes = "", landed?: string): Shadow {
  const git = gitMerge(base, main, branch);
  const ours = lineMerge(path, base, main, branch, attributes);
  const guard = ours.conflicts.some((c) => c.lint);
  const verdict: Verdict = guard ? "guard"
    : ours.conflicts.length && ours.conflicts.every((c) => c.whole) ? "lock"
    : git.clean && !ours.clean ? "ours-only"
    : !git.clean && ours.clean ? "git-only"
    : git.clean && ours.clean && git.text !== ours.text ? "differ"
    : !git.clean && !ours.clean ? "both"
    : "agree";
  if (landed === undefined) return { verdict, git, ours };
  const o = ours.text;
  return { verdict, git, ours, landed: {
    git: git.clean && git.text === landed, ours: o === landed,
    off: o === null ? 0 : linesOff(o, landed), reordered: o !== null && o !== landed && sorted(o) === sorted(landed),
  } };
}

const sorted = (s: string) => s.split("\n").sort().join("\n");

/** How many lines a diff from `a` to `b` touches. */
function linesOff(a: string, b: string) {
  const d = empty();
  apply(d, fromText(a), "a");
  return diffToOps(d.lines, b.split("\n")).length;
}

/** codeSplitter's merge as a branch merge runs it: each side's text diffed to line ops on one base doc, then lint. */
export function lineMerge(path: string, base: string, main: string, branch: string, attributes = "") {
  const m = empty();
  apply(m, fromText(base), "base");
  const b = structuredClone(m), br = structuredClone(m);
  apply(m, diffToOps(m.lines, main.split("\n")), "main");
  apply(br, diffToOps(br.lines, branch.split("\n")), "branch");
  const r = merge(b, br, m, {}, "branch", path, "branch", policyOf(path, attributes).merge);
  const conflicts = [...r.conflicts];
  let out: string | null = null;
  if (!conflicts.length) {
    conflicts.push(...lintMerge(path, m, br, r));
    const d: Doc = structuredClone(m);
    if (apply(d, r.ops, r.by, 0, m.rev).ok) out = text(d);
    else conflicts.push({ line: "apply", base: "", main: null, branch: null, lint: "the merge's ops don't apply to main" });
  }
  return { clean: !conflicts.length, text: out, conflicts };
}

/** git's own three-way merge of one file's text. */
export function gitMerge(base: string, main: string, branch: string) {
  const dir = mkdtempSync(join(tmpdir(), "shadow-"));
  try {
    const [b, m, br] = ["base", "main", "branch"].map((n) => join(dir, n));
    writeFileSync(b!, base); writeFileSync(m!, main); writeFileSync(br!, branch);
    const r = Bun.spawnSync(["git", "merge-file", "-p", "--diff3", "-L", "main", "-L", "base", "-L", "branch", m!, b!, br!]);
    if (r.exitCode! < 0 || r.exitCode! > 127) throw new Error(`git merge-file: ${r.stderr.toString()}`);
    return { clean: r.exitCode === 0, text: r.stdout.toString() };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// `cwd`: the repo, when it isn't the one this runs in (the tests' scratch repos).
let cwd: string | undefined;
const git = (...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd });
  return r.exitCode === 0 ? r.stdout.toString() : null;
};
const show = (rev: string, path: string) => git("show", `${rev}:${path}`);
/** Runs the git commands below in `repo` (tests only). */
export const useRepo = (repo?: string) => { cwd = repo; };
// merge-tree's paths and archive's files are the current folder's: run them at the top.
const top = () => cwd ?? git("rev-parse", "--show-toplevel")!.trim();
// Changed or added: a file both sides added is a merge from an empty base.
const changed = (from: string, to: string) => new Set((git("diff", "--name-only", "--no-renames", "--diff-filter=AM", from, to) ?? "").split("\n").filter(Boolean));
const binary = (s: string) => s.includes("\0");

interface Pr { number: number; headRefOid: string; mergeCommit: { oid: string } | null }
/** One merge git made: the two sides it joined and what it committed. */
interface Join { label: string; main: string; branch: string; landed: string }

/**
 * A PR's merges: its squash onto main (main just before it, the PR's head), and
 * each time the branch took main in on the way (a merge commit in its range,
 * first parent the branch's), which is where most real conflicts were settled.
 */
function joins(pr: Pr): Join[] | null {
  const landed = pr.mergeCommit?.oid;
  const main = landed && git("rev-parse", "--verify", "-q", `${landed}^1`)?.trim();
  if (!landed || !main || git("cat-file", "-e", pr.headRefOid) === null) return null;
  const inner = (git("rev-list", "--merges", "--parents", `${main}..${pr.headRefOid}`) ?? "").split("\n").filter(Boolean).map((l) => l.split(" "));
  return [
    { label: `#${pr.number}`, main, branch: pr.headRefOid, landed },
    ...inner.map(([x, branch, main]) => ({ label: `#${pr.number} ${x!.slice(0, 7)}`, main: main!, branch: branch!, landed: x! })),
  ];
}

/** One test command to run in a checked-out tree: `dir` relative to its root. */
export interface Run { dir: string; cmd: string }

/**
 * The tests CI ran for a change to `paths`, from that tree's own
 * scripts/ci-apps.ts (`ciApps`, its text: old trees name old apps): each
 * touched app's `test`, and `bun test packages` for packages/. An app whose row
 * has no test command isn't run.
 */
export function testRuns(ciApps: string, paths: string[]): Run[] {
  const rows = new Map([...ciApps.matchAll(/^\s*"([\w-]+)":\s*\{(.*)\},?\s*$/gm)].map((m) => [m[1]!, m[2]!.match(/\btest:\s*"([^"]*)"/)?.[1]]));
  const runs: Run[] = [];
  for (const app of new Set(paths.map((p) => p.match(/^apps\/([^/]+)\//)?.[1]).filter((a): a is string => !!a))) {
    const cmd = rows.get(app);
    if (cmd) runs.push({ dir: `apps/${app}`, cmd });
  }
  if (paths.some((p) => p.startsWith("packages/"))) runs.push({ dir: ".", cmd: "bun test packages" });
  return runs;
}

/**
 * Writes the tree a merge would have committed into `dir`: git's merge of the
 * two sides, `ours` (path to text) over the files git conflicted on, and what
 * landed over any other conflicted file (deleted if it didn't land).
 */
export function writeMerge(dir: string, main: string, branch: string, landed: string, ours: Map<string, string>) {
  const r = Bun.spawnSync(["git", "merge-tree", "--write-tree", "--name-only", "-z", main, branch], { cwd: top() });
  if (r.exitCode !== 0 && r.exitCode !== 1) throw new Error(`git merge-tree: ${r.stderr.toString()}`);
  // -z: the tree, then each conflicted path, then a blank entry before the messages.
  const [tree, ...rest] = r.stdout.toString().split("\0");
  const conflicted = new Set(rest.slice(0, Math.max(0, rest.indexOf(""))));
  writeTree(dir, tree!);
  for (const path of conflicted) {
    const t = ours.get(path) ?? show(landed, path);
    if (t === null) rmSync(join(dir, path), { force: true });
    else { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), t); }
  }
  for (const [path, t] of ours) if (!conflicted.has(path)) writeFileSync(join(dir, path), t);
}

/** A commit's or tree's files, written into `dir`. */
export function writeTree(dir: string, tree: string) {
  mkdirSync(dir, { recursive: true });
  const r = Bun.spawnSync(["sh", "-c", 'git archive "$1" | tar -x -C "$2"', "sh", tree, dir], { cwd: top() });
  if (r.exitCode !== 0) throw new Error(`git archive ${tree}: ${r.stderr.toString()}`);
}

export interface Check {
  /**
   * pass; fail (a test fails that passes on what landed); same (failures, but
   * what landed fails them too: the sandbox, a native build); untested (no
   * tests for these files).
   */
  result: "pass" | "fail" | "same" | "untested";
  runs: (Run & { ok: boolean })[];
  /** The tests that fail here and pass on what landed, `dir: name`. */
  failed?: string[];
  /** The end of each failing run's output. */
  log?: string;
}

// Nothing from this shell (tokens, account ids) reaches the tests: an empty HOME, bun's cache kept,
// and a git identity for the tests that commit.
function sandbox(home: string) {
  const who = { NAME: "shadow", EMAIL: "shadow@localhost" };
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: tmpdir(), CI: "1", NO_COLOR: "1",
    BUN_INSTALL_CACHE_DIR: join(homedir(), ".bun/install/cache"),
    GIT_AUTHOR_NAME: who.NAME, GIT_AUTHOR_EMAIL: who.EMAIL, GIT_COMMITTER_NAME: who.NAME, GIT_COMMITTER_EMAIL: who.EMAIL,
  };
}

async function sh(root: string, run: Run, env: Record<string, string>) {
  const p = Bun.spawn(["sh", "-c", run.cmd], { cwd: join(root, run.dir), env, stdout: "pipe", stderr: "pipe", timeout: 15 * 60_000 });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { ok: (await p.exited) === 0, out: `${out}${err}` };
}

/** The tests a `bun test` run names as failed, or the whole command when it failed without naming one. */
export function failures(run: Run, out: string) {
  const names = [...new Set([...out.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm)].map((m) => `${run.dir}: ${m[1]}`))];
  return names.length ? names : [`${run.dir}: ${run.cmd}`];
}

/** Installs and runs each of `runs` in `root`, and what failed. */
async function testTree(root: string, runs: Run[], env: Record<string, string>) {
  const done: (Run & { ok: boolean })[] = [], failed: string[] = [], logs: string[] = [];
  const steps = existsSync(join(root, "package.json")) ? [{ dir: ".", cmd: "bun install" }, ...runs] : runs;
  for (const run of steps) {
    const r = await sh(root, run, env);
    done.push({ ...run, ok: r.ok });
    if (r.ok) continue;
    failed.push(...failures(run, r.out));
    logs.push(r.out.split("\n").slice(-30).join("\n"));
    if (run.cmd === "bun install") break;
  }
  return { runs: done, failed, log: logs.join("\n") };
}

/** Builds and tests one merge with ours over git's conflicts, then what landed if anything fails. */
export async function check(main: string, branch: string, landed: string, ours: Map<string, string>): Promise<Check> {
  const runs = testRuns(show(main, "scripts/ci-apps.ts") ?? "", [...ours.keys()]);
  if (!runs.length) return { result: "untested", runs: [] };
  const tmp = mkdtempSync(join(tmpdir(), "shadow-check-"));
  try {
    const env = sandbox(join(tmp, "home"));
    mkdirSync(env.HOME);
    writeMerge(join(tmp, "ours"), main, branch, landed, ours);
    const o = await testTree(join(tmp, "ours"), runs, env);
    if (!o.failed.length) return { result: "pass", runs: o.runs };
    writeTree(join(tmp, "landed"), landed);
    const l = new Set((await testTree(join(tmp, "landed"), runs, env)).failed);
    const failed = o.failed.filter((f) => !l.has(f));
    return { result: failed.length ? "fail" : "same", runs: o.runs, failed, log: o.log };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const only = arg("pr")?.split(",").map(Number);
  const from = arg("from");
  const checking = process.argv.includes("--check");
  if (checking && !only) throw new Error("--check installs and tests each merge: pick them with --pr");
  const prs: Pr[] = JSON.parse(from ? readFileSync(from, "utf8")
    : Bun.spawnSync(["gh", "pr", "list", "--state", "merged", "--limit", arg("limit") ?? "1000", "--json", "number,headRefOid,mergeCommit"]).stdout.toString() || "[]");
  const tally: Record<Verdict | "prs" | "skipped" | "merges" | "files", number> = { agree: 0, both: 0, "git-only": 0, "ours-only": 0, differ: 0, guard: 0, lock: 0, prs: 0, skipped: 0, merges: 0, files: 0 };
  const found: { label: string; path: string; s: Shadow; check?: Check }[] = [];
  const checks: Record<Check["result"], number> = { pass: 0, fail: 0, same: 0, untested: 0 };
  for (const pr of prs) {
    if (only && !only.includes(pr.number)) continue;
    tally.prs++;
    const js = joins(pr);
    if (!js) { tally.skipped++; continue; }
    for (const j of js) {
      const base = git("merge-base", j.main, j.branch)?.trim();
      if (!base) continue;
      tally.merges++;
      const attributes = show(j.main, ".gitattributes") ?? "";
      const theirs = changed(base, j.branch);
      const gitOnly: (typeof found)[number][] = [];
      for (const path of changed(base, j.main)) {
        if (!theirs.has(path)) continue;
        const [b = "", m, br] = [show(base, path) ?? undefined, show(j.main, path), show(j.branch, path)];
        if (m == null || br == null || [b, m, br].some(binary) || m === br) continue;
        tally.files++;
        const s = shadow(path, b, m, br, attributes, show(j.landed, path) ?? undefined);
        tally[s.verdict]++;
        if (s.verdict === "agree") continue;
        found.push({ label: j.label, path, s });
        if (s.verdict === "git-only") gitOnly.push(found.at(-1)!);
      }
      if (!checking || !gitOnly.length) continue;
      console.error(`checking ${j.label}: ${gitOnly.map((f) => f.path).join(", ")}`);
      const c = await check(j.main, j.branch, j.landed, new Map(gitOnly.map((f) => [f.path, f.s.ours.text!])));
      checks[c.result]++;
      for (const f of gitOnly) f.check = c;
    }
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify({ tally, ...checking && { checks }, found }, null, 2));
  else {
    console.log(`${tally.merges} merges from ${tally.prs - tally.skipped} PRs (${tally.skipped} skipped: not in this clone), ${tally.files} files both sides changed`);
    console.log((["agree", "both", "git-only", "ours-only", "differ", "guard", "lock"] as const).map((k) => `${k} ${tally[k]}`).join(" · "));
    if (checking) console.log(`checked merges: ${Object.entries(checks).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
    const logged = new Set<Check>();
    for (const { label, path, s, check: c } of found) {
      const why = s.ours.conflicts.map((c) => c.lint ? `${c.line}: ${c.lint}` : c.line).join(", ");
      const matched = s.landed && [s.landed.git && "git's", s.landed.ours && "ours"].filter(Boolean).join(" and ");
      const note = s.landed ? ` (landed: ${matched || "neither"}${s.ours.clean && !s.landed.ours ? `, ${s.landed.reordered ? "ours reordered" : `${s.landed.off} lines off ours`}` : ""})` : "";
      const ran = c ? ` check: ${c.result}${c.runs.length ? ` (${c.runs.map((r) => `${r.dir} ${r.cmd} ${r.ok ? "ok" : "failed"}`).join(", ")})` : ""}` : "";
      console.log(`${label} ${path}: ${s.verdict}${note}${why ? ` [${why}]` : ""}${ran}`);
      if (c?.failed?.length && !logged.has(c)) { logged.add(c); console.log(c.failed.map((f) => `    fails here, passes as landed: ${f}`).join("\n")); }
    }
  }
}
