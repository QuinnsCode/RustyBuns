// Do the new tests bite? `bun scripts/test-bites.ts` takes the *.test.ts files this branch adds or edits against
// origin/main (committed or not), checks origin/main out into a scratch worktree under the OS tmp dir, copies those
// test files over it and runs each one there with `bun test`. A test that still passes on the old code proves
// nothing about the change: each one is printed and the exit code is 1. The scratch worktree is removed after.
// Not in CI yet (#3527).
//
//   bun scripts/test-bites.ts                 against origin/main
//   bun scripts/test-bites.ts --base <ref>    against another ref
import { $ } from "bun";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { help } from "./help.ts";

/** The *.test.ts files the working tree adds or edits since its merge-base with `base`. */
export async function changedTests(repo: string, base: string): Promise<string[]> {
  const fork = (await $`git merge-base ${base} HEAD`.cwd(repo).text()).trim();
  const out = await $`git diff --name-only --diff-filter=AM ${fork} -- ${"*.test.ts"}`.cwd(repo).text();
  return out.split("\n").filter(Boolean);
}

/** The nearest folder at or above `file` (inside `root`) holding a package.json, else `root`: where its test runs. */
function home(root: string, file: string): string {
  for (let dir = dirname(join(root, file)); dir.startsWith(root); dir = dirname(dir)) if (existsSync(join(dir, "package.json"))) return dir;
  return root;
}

/** Runs `files` (from the working tree of `repo`) on `base`'s source and returns the ones that pass there. */
export async function passesOnBase(repo: string, base: string, files: string[]): Promise<string[]> {
  if (!files.length) return [];
  const scratch = join(mkdtempSync(join(tmpdir(), "test-bites-")), "base");
  await $`git worktree add -q --detach ${scratch} ${base}`.cwd(repo).quiet();
  try {
    const passing: string[] = [];
    for (const file of files) {
      mkdirSync(dirname(join(scratch, file)), { recursive: true });
      copyFileSync(join(repo, file), join(scratch, file));
      // Installed packages aren't in a fresh worktree: borrow the repo's, from the test's folder up to the root.
      for (let dir = dirname(file); ; dir = dirname(dir)) {
        const from = join(repo, dir, "node_modules"), to = join(scratch, dir, "node_modules");
        if (existsSync(from) && !existsSync(to)) symlinkSync(from, to);
        if (dir === ".") break;
      }
    }
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
  process.exit(passing.length ? 1 : 0);
}
