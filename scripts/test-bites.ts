// Do the new tests bite? `bun scripts/test-bites.ts` takes the *.test.ts files this branch adds or edits against
// origin/main (committed or not), checks origin/main out into a scratch worktree under the OS tmp dir, copies those
// test files over it and runs each one there with `bun test`. A test that still passes on the old code proves
// nothing about the change: each one is printed and the exit code is 1. The scratch worktree is removed after.
// The repo's node_modules folders are rebuilt in the scratch worktree as the trees of relative symlinks they are, so
// a workspace package (`@rustybuns/util`) resolves to the base's source, not this branch's.
//
// `--lines` also lists the changed source lines those tests never ran (`bun test --coverage` here, lines from
// `git diff -U0`): code nobody ran. A report, not a gate; there is no percentage to hit. Not in CI yet (#4154).
//
//   bun scripts/test-bites.ts                 against origin/main
//   bun scripts/test-bites.ts --base <ref>    against another ref
//   bun scripts/test-bites.ts --lines         and the changed lines they never ran
import { $ } from "bun";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
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

/** Runs `files` (from the working tree of `repo`) on `base`'s source and returns the ones that pass there. */
export async function passesOnBase(repo: string, base: string, files: string[]): Promise<string[]> {
  if (!files.length) return [];
  const scratch = join(mkdtempSync(join(tmpdir(), "test-bites-")), "base");
  await $`git worktree add -q --detach ${scratch} ${base}`.cwd(repo).quiet();
  try {
    for (const file of files) {
      mkdirSync(dirname(join(scratch, file)), { recursive: true });
      copyFileSync(join(repo, file), join(scratch, file));
    }
    linkModules(repo, scratch);
    const passing: string[] = [];
    for (const file of files) {
      const cwd = home(scratch, file);
      const run = await $`bun test ${"./" + relative(cwd, join(scratch, file))}`.cwd(cwd).quiet().nothrow();
      if (run.exitCode === 0) passing.push(file);
    }
    return passing;
  } finally {
    await $`git worktree remove --force ${scratch}`.cwd(repo).quiet().nothrow();
    rmSync(dirname(scratch), { recursive: true, force: true });
  }
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

/** Changed source lines (not tests) that `tests` never ran, by file; a file they never loaded maps to "unloaded". */
export async function unrunLines(repo: string, base: string, tests: string[]): Promise<Map<string, number[] | "unloaded">> {
  const out = new Map<string, number[] | "unloaded">();
  if (!tests.length) return out;
  const diff = await $`git diff -U0 --no-color --diff-filter=AM ${await fork(repo, base)} -- ${"*.ts"} ${"*.tsx"} ${":!*.test.ts"} ${":!*.test.tsx"}`.cwd(repo).text();
  const added = addedLines(diff);
  if (!added.size) return out;
  const hits = new Map<string, Map<number, number>>();
  const scratch = mkdtempSync(join(tmpdir(), "test-lines-"));
  try {
    for (const [cwd, group] of Map.groupBy(tests, (t) => home(repo, t))) {
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
  const at = process.argv.indexOf("--base");
  const base = at > 0 ? process.argv[at + 1] ?? "origin/main" : "origin/main";
  const repo = (await $`git rev-parse --show-toplevel`.text()).trim();
  const files = await changedTests(repo, base);
  if (!files.length) {
    console.log(`no *.test.ts added or edited since ${base}`);
    process.exit(0);
  }
  const passing = await passesOnBase(repo, base, files);
  for (const f of passing) console.log(`${f}: passes on ${base} too, proves nothing`);
  console.log(`${files.length - passing.length} of ${files.length} test files fail on ${base}`);
  if (process.argv.includes("--lines")) {
    const unrun = await unrunLines(repo, base, files);
    console.log(unrun.size ? "changed lines these tests never ran:" : "these tests ran every changed source line");
    for (const [file, lines] of unrun) console.log(`  ${file}: ${lines === "unloaded" ? "never loaded" : ranges(lines)}`);
  }
  process.exit(passing.length ? 1 : 0);
}
