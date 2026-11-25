// Do the new tests bite? `bun scripts/test-bites.ts` takes the *.test.ts files this branch adds or edits against
// origin/main (committed or not), checks origin/main out into a scratch worktree under the OS tmp dir, copies those
// test files over it and runs each one there with `bun test`. A test that still passes on the old code proves
// nothing about the change: each one is printed and the exit code is 1. The scratch worktree is removed after.
// The repo's node_modules folders are rebuilt in the scratch worktree as the trees of relative symlinks they are, so
// a workspace package (`@rustybuns/util`) resolves to the base's source, not this branch's.
//
// `--lines` also lists the changed source lines those tests never ran (`bun test --coverage` here, lines from
// `git diff -U0`): code nobody ran. A report, not a gate; there is no percentage to hit. CI runs it on every PR that
// edits a test, report only: the `bites` job in apps.yml writes this to its summary and never fails the PR (#4154).
//
// `--mutate [n]` is mutation testing on the diff: up to n (default 20) changed source lines each get one operator
// flipped (`===` to `!==`, `<` to `>=`, `&&` to `||`, `true` to `false`, `+` to `-`) in a scratch copy of the working
// tree, and the changed tests run against each. A flip no test notices is printed as a survivor: a line the tests run
// but don't check. A report too: some flips change nothing anyone could see.
//
// A test file whose diff only touches comments, blank lines or its `setDefaultTimeout(n)` has nothing new in it to bite:
// it is skipped and counted. No new file starts after `--minutes` (default 12, inside CI's 20); the ones left are named.
//
//   bun scripts/test-bites.ts                 against origin/main
//   bun scripts/test-bites.ts --base <ref>    against another ref
//   bun scripts/test-bites.ts --lines         and the changed lines they never ran
//   bun scripts/test-bites.ts --mutate 10     and which of 10 flipped changed lines no test notices
//   bun scripts/test-bites.ts --lines --facts f.json   and the counts as JSON for scripts/lane.ts (#5429):
//                                             { tests, failOnBase, changed, unrun } (unrun counts a never-loaded file whole)
import { $ } from "bun";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { killGroup } from "./chrome.ts";
import { help } from "./help.ts";

const fork = async (repo: string, base: string) => (await $`git merge-base ${base} HEAD`.cwd(repo).text()).trim();

/** The *.test.ts files the working tree adds or edits since its merge-base with `base`, untracked ones too. */
export async function changedTests(repo: string, base: string): Promise<string[]> {
  const edited = await $`git diff --name-only --diff-filter=AM ${await fork(repo, base)} -- ${"*.test.ts"}`.cwd(repo).text();
  const fresh = await $`git ls-files --others --exclude-standard -- ${"*.test.ts"}`.cwd(repo).text();
  return [...new Set(`${edited}\n${fresh}`.split("\n").filter(Boolean))];
}

/** The nearest folder at or above `file` (inside `root`) holding a package.json, else `root`: where its test runs. */
function home(root: string, file: string): string {
  for (let dir = dirname(join(root, file)); dir.startsWith(root); dir = dirname(dir)) if (existsSync(join(dir, "package.json"))) return dir;
  return root;
}

/** Every node_modules under `repo` rebuilt in `into` where its folder exists there. They hold relative symlinks
 * (`@rustybuns/util -> ../../../../packages/util`), so copies point at `into`'s own packages; the store is linked. */
function linkModules(repo: string, into: string, dir = "."): void {
  for (const e of readdirSync(join(repo, dir), { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === ".git") continue;
    const rel = join(dir, e.name);
    if (e.name !== "node_modules") {
      if (existsSync(join(into, rel))) linkModules(repo, into, rel);
      continue;
    }
    if (existsSync(join(into, rel))) continue;
    mkdirSync(join(into, rel));
    for (const m of readdirSync(join(repo, rel))) {
      if (m === ".bun") symlinkSync(resolve(repo, rel, m), join(into, rel, m));
      else cpSync(join(repo, rel, m), join(into, rel, m), { recursive: true, verbatimSymlinks: true });
    }
  }
}

/** The scratch folders in use, and the end of anything still running from one: a test's `bun -e` and its headless Chrome
 *  outlived test-bites on the builder for days (#5337). Every process whose command line names the folder goes with -9. */
const scratches = new Set<string>();
const reap = (dir: string) => Bun.spawnSync(["pkill", "-9", "-f", "--", dir]);

/** `ref` checked out in a scratch worktree with `files` copied over it from `repo`'s working tree and its
 *  node_modules linked, handed to `use`, then removed. */
async function scratchTree<T>(repo: string, ref: string, files: string[], use: (scratch: string) => Promise<T>): Promise<T> {
  const scratch = join(mkdtempSync(join(tmpdir(), "test-bites-")), "tree");
  scratches.add(dirname(scratch));
  await $`git worktree add -q --detach ${scratch} ${ref}`.cwd(repo).quiet();
  try {
    for (const file of files) {
      mkdirSync(dirname(join(scratch, file)), { recursive: true });
      copyFileSync(join(repo, file), join(scratch, file));
    }
    linkModules(repo, scratch);
    return await use(scratch);
  } finally {
    reap(dirname(scratch));
    scratches.delete(dirname(scratch));
    await $`git worktree remove --force ${scratch}`.cwd(repo).quiet().nothrow();
    rmSync(dirname(scratch), { recursive: true, force: true });
  }
}

/** How long a run may go before it stops starting files: past it, the files left are named, not run. */
export type Budget = { by?: number; late?: string[]; each?: (file: string, passes: boolean) => void };

/** Runs `files` (from the working tree of `repo`) on `base`'s source and returns the ones that pass there. A file not
 *  started by `budget.by` (epoch ms) goes in `budget.late`; `budget.each` hears each result as it lands. */
export async function passesOnBase(repo: string, base: string, files: string[], budget: Budget = {}): Promise<string[]> {
  if (!files.length) return [];
  return scratchTree(repo, base, files, async (scratch) => {
    const passing: string[] = [];
    for (const file of files) {
      if (Date.now() > (budget.by ?? Infinity)) { budget.late?.push(file); continue; }
      const passes = await testsPass(scratch, [file]);
      if (passes) passing.push(file);
      budget.each?.(file, passes);
    }
    return passing;
  });
}

/** A changed line that can't change what a test checks: blank, a comment, or a `setDefaultTimeout(n)` call. */
const inertLine = (line: string) => {
  const s = line.trim();
  return !s || /^(\/\/|\/\*|\*)/.test(s) || /^setDefaultTimeout\(\s*[\d_]+\s*\);?\s*(\/\/.*)?$/.test(s);
};

/** The files in a `git diff -U0` whose added and removed lines are all inert (`inertLine`): no test body changed in
 *  them, so there is nothing new in them to bite, and running them on the base only spends time (#5925). */
export function inertFiles(diff: string): Set<string> {
  const live = new Set<string>(), all = new Set<string>();
  let file = "", inHunk = false;
  for (const line of diff.split("\n")) {
    const head = line.match(/^diff --git a\/.* b\/(.*)$/);
    if (head) { file = head[1]!; all.add(file); inHunk = false; continue; }
    if (line.startsWith("@@")) { inHunk = true; continue; }
    if (!inHunk || !file) continue;
    if ((line.startsWith("+") || line.startsWith("-")) && !inertLine(line.slice(1))) live.add(file);
  }
  return new Set([...all].filter((f) => !live.has(f)));
}

/** Which of `files` change since the merge-base with `base` only in inert lines. A file git doesn't track yet is new: never inert. */
export async function inertTests(repo: string, base: string, files: string[]): Promise<string[]> {
  if (!files.length) return [];
  const inert = inertFiles(await $`git diff -U0 --no-color ${await fork(repo, base)} -- ${files}`.cwd(repo).text());
  return files.filter((f) => inert.has(f));
}

/** True when every one of `tests` passes in `root`; a run that outlives `ms` (a flip can loop forever) is a failure. */
async function testsPass(root: string, tests: string[], ms = 180_000): Promise<boolean> {
  for (const [cwd, group] of Map.groupBy(tests, (t) => home(root, t))) {
    const cmd = ["bun", "test", ...group.map((t) => "./" + relative(cwd, join(root, t)))];
    // its own process group: a timeout, or the run ending, takes everything the tests started with it
    const run = Bun.spawn(cmd, { cwd, stdout: "ignore", stderr: "ignore", detached: true });
    const late = setTimeout(() => void killGroup(run, 2000), ms);
    const code = await run.exited;
    clearTimeout(late);
    await killGroup(run, 0);
    if (code !== 0) return false;
  }
  return true;
}

/** The flips `--mutate` tries, in order; spaces around `<`, `>`, `+` and `-` keep generics, arrows and `++` out. */
const FLIPS: [RegExp, string][] = [
  [/===/, "!=="], [/!==/, "==="], [/<=/, ">"], [/>=/, "<"], [/ < /, " >= "], [/ > /, " <= "],
  [/&&/, "||"], [/\|\|/, "&&"], [/\btrue\b/, "false"], [/\bfalse\b/, "true"], [/ \+ /, " - "], [/ - /, " + "],
];

/** `line` with its first flippable operator flipped, or undefined: comments, imports and text in quotes stay as they are. */
export function mutate(line: string): string | undefined {
  if (/^\s*(\/\/|\/?\*|import\b)/.test(line)) return undefined;
  const bare = line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, (q) => q[0] + "_".repeat(q.length - 2) + q[0]).replace(/\/\/.*$/, "");
  for (const [op, to] of FLIPS) {
    const m = op.exec(bare);
    if (m) return line.slice(0, m.index) + to + line.slice(m.index + m[0].length);
  }
  return undefined;
}

export type Flip = { file: string; line: number; now: string };

/** Up to `max` changed source lines flipped one at a time (`mutate`) in a scratch copy of `repo`'s working tree, with
 *  `tests` run against each: the flips they all still pass. Undefined when `tests` fail before anything is flipped. */
export async function survivors(repo: string, base: string, tests: string[], max = 20): Promise<{ tried: number; survived: Flip[] } | undefined> {
  const flips: Flip[] = [];
  for (const [file, lines] of await changedSource(repo, base)) {
    const src = (await Bun.file(join(repo, file)).text()).split("\n");
    for (const n of lines) {
      const now = mutate(src[n - 1] ?? "");
      if (now !== undefined && flips.length < max) flips.push({ file, line: n, now });
    }
  }
  if (!tests.length || !flips.length) return { tried: 0, survived: [] };
  const dirty = `${await $`git diff --name-only HEAD`.cwd(repo).text()}\n${await $`git ls-files --others --exclude-standard`.cwd(repo).text()}`.split("\n");
  return scratchTree(repo, "HEAD", dirty.filter((f) => f && existsSync(join(repo, f))), async (scratch) => {
    if (!(await testsPass(scratch, tests))) return undefined;
    const survived: Flip[] = [];
    for (const flip of flips) {
      const path = join(scratch, flip.file), was = await Bun.file(path).text(), lines = was.split("\n");
      lines[flip.line - 1] = flip.now;
      await Bun.write(path, lines.join("\n"));
      if (await testsPass(scratch, tests)) survived.push(flip);
      await Bun.write(path, was);
    }
    return { tried: flips.length, survived };
  });
}

/** Lines on the new side of a `git diff -U0`, by file. */
export function addedLines(diff: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) file = line.slice(4).replace(/^b\//, "");
    const h = line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
    if (!h || !file || file === "/dev/null") continue;
    const start = Number(h[1]), count = h[2] === undefined ? 1 : Number(h[2]);
    if (count) out.set(file, [...(out.get(file) ?? []), ...Array.from({ length: count }, (_, i) => start + i)]);
  }
  return out;
}

/** True when every file the working tree changes since the merge-base is a test: then `base` with those tests copied over
 *  is the working tree itself, and every one of them passes there without running it (a refactor of the tests, #5919). */
export async function onlyTests(repo: string, base: string): Promise<boolean> {
  const changed = await $`git diff --name-only ${await fork(repo, base)}`.cwd(repo).text();
  const fresh = await $`git ls-files --others --exclude-standard`.cwd(repo).text();
  return `${changed}\n${fresh}`.split("\n").filter(Boolean).every((p) => /\.test\.tsx?$/.test(p));
}

/** The lines each changed source file (not a test) adds since the merge-base with `base`, by file. */
export async function changedSource(repo: string, base: string): Promise<Map<string, number[]>> {
  const diff = await $`git diff -U0 --no-color --diff-filter=AM ${await fork(repo, base)} -- ${"*.ts"} ${"*.tsx"} ${":!*.test.ts"} ${":!*.test.tsx"}`.cwd(repo).text();
  return addedLines(diff);
}

/** Changed source lines (not tests) that `tests` never ran, by file; a file they never loaded maps to "unloaded". */
export async function unrunLines(repo: string, base: string, tests: string[], by = Infinity): Promise<Map<string, number[] | "unloaded">> {
  const out = new Map<string, number[] | "unloaded">();
  if (!tests.length) return out;
  const added = await changedSource(repo, base);
  if (!added.size) return out;
  const hits = new Map<string, Map<number, number>>();
  const scratch = mkdtempSync(join(tmpdir(), "test-lines-"));
  try {
    for (const [cwd, group] of Map.groupBy(tests, (t) => home(repo, t))) {
      if (Date.now() > by) break; // what wasn't run reads as never loaded: a report, not a gate
      const dir = join(scratch, String(hits.size));
      await $`bun test --coverage --coverage-reporter=lcov --coverage-dir=${dir} ${group.map((t) => "./" + relative(cwd, join(repo, t)))}`.cwd(cwd).quiet().nothrow();
      const lcov = Bun.file(join(dir, "lcov.info"));
      if (!(await lcov.exists())) continue;
      let seen: Map<number, number> | undefined;
      for (const line of (await lcov.text()).split("\n")) {
        if (line.startsWith("SF:")) {
          const file = relative(repo, resolve(cwd, line.slice(3).trim()));
          hits.set(file, (seen = hits.get(file) ?? new Map()));
        }
        const da = line.match(/^DA:(\d+),(\d+)/);
        if (da && seen) seen.set(Number(da[1]), (seen.get(Number(da[1])) ?? 0) + Number(da[2]));
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const [file, lines] of added) {
    const seen = hits.get(file);
    const missed = seen ? lines.filter((n) => seen.get(n) === 0) : "unloaded";
    if (missed.length) out.set(file, missed);
  }
  return out;
}

/** `[3, 4, 5, 9]` as `3-5, 9`. */
export function ranges(lines: number[]): string {
  const parts: string[] = [];
  for (let i = 0, j = 0; i < lines.length; i = ++j) {
    while (lines[j + 1] === lines[j]! + 1) j++;
    parts.push(j > i ? `${lines[i]}-${lines[j]}` : `${lines[i]}`);
  }
  return parts.join(", ");
}

if (import.meta.main) {
  help(import.meta.path);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => { for (const dir of scratches) reap(dir); process.exit(130); });
  const at = process.argv.indexOf("--base");
  const base = at > 0 ? process.argv[at + 1] ?? "origin/main" : "origin/main";
  const repo = (await $`git rev-parse --show-toplevel`.text()).trim();
  const edited = await changedTests(repo, base);
  const f = process.argv.indexOf("--facts");
  const factsAt = f > 0 ? process.argv[f + 1] : undefined;
  const inert = await inertTests(repo, base, edited);
  const files = edited.filter((t) => !inert.includes(t));
  if (inert.length) console.log(`skipped: only timeouts/comments changed in ${inert.length} test file${inert.length === 1 ? "" : "s"}`);
  if (!files.length) {
    if (factsAt) await Bun.write(factsAt, JSON.stringify({ tests: 0, failOnBase: 0, changed: 0, unrun: 0 }));
    console.log(edited.length ? "no test body changed: nothing to run" : `no *.test.ts added or edited since ${base}`);
    process.exit(0);
  }
  // CI's job has 20 minutes: past the budget no new file starts, and each result is printed as it lands, so a run cut
  // short still says what it checked
  const mi = process.argv.indexOf("--minutes");
  const by = Date.now() + (mi > 0 ? Number(process.argv[mi + 1]) || 12 : 12) * 60_000;
  const late: string[] = [];
  const each = (file: string, passes: boolean) => passes && console.log(`${file}: passes on ${base} too, proves nothing`);
  // the run on the base and the coverage run on this tree don't touch each other: side by side, not one after the other
  const tests = await onlyTests(repo, base);
  const [passing, unrun] = await Promise.all([
    tests ? files : passesOnBase(repo, base, files, { by, late, each }),
    process.argv.includes("--lines") ? unrunLines(repo, base, files, by) : undefined,
  ]);
  if (tests) {
    console.log(`only tests changed since ${base}: they pass there as here, so none was run on it`);
    for (const f of passing) each(f, true);
  }
  if (late.length) console.log(`out of time: ${late.length} not run on ${base}: ${late.join(", ")}`);
  const checked = files.length - late.length;
  console.log(`${checked - passing.length} of ${checked} test files fail on ${base}`);
  if (unrun) {
    console.log(unrun.size ? "changed lines these tests never ran:" : "these tests ran every changed source line");
    for (const [file, lines] of unrun) console.log(`  ${file}: ${lines === "unloaded" ? "never loaded" : ranges(lines)}`);
  }
  if (factsAt) {
    const added = await changedSource(repo, base);
    const missed = [...(unrun ?? added)].reduce((n, [file, lines]) => n + (lines === "unloaded" ? added.get(file)?.length ?? 0 : lines.length), 0);
    const changed = [...added.values()].reduce((n, l) => n + l.length, 0);
    await Bun.write(factsAt, JSON.stringify({ tests: checked, failOnBase: checked - passing.length, changed, unrun: missed }));
  }
  const m = process.argv.indexOf("--mutate");
  if (m > 0) {
    const r = await survivors(repo, base, files, Number(process.argv[m + 1]) > 0 ? Number(process.argv[m + 1]) : 20);
    if (!r) console.log("--mutate: these tests fail on the working tree as it is, so nothing was flipped");
    else if (!r.tried) console.log("--mutate: no changed source line has an operator to flip");
    else console.log(`--mutate: these tests catch ${r.tried - r.survived.length} of ${r.tried} flipped lines`);
    for (const s of r?.survived ?? []) console.log(`  ${s.file}:${s.line} survives: ${s.now.trim()}`);
  }
  process.exit(passing.length ? 1 : 0);
}
