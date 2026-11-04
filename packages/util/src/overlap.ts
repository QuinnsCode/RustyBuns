// Which work would collide before it starts (#1163, #3119): the files a task's text names, and the open branches
// already changing them. codeSplitter's dispatch hint, scripts/preflight.ts and the office's hire guard all ask this.

/** Files that every PR may touch and that are rebuilt, not merged by hand. */
export const GENERATED = [/(^|\/)bun\.lock$/, /(^|\/)package-lock\.json$/, /(^|\/)REFERENCE\.md$/, /^README\.md$/];

/**
 * A task's files before it has any edits (#1163): the repo's paths its text names, whole (`src/main.ts`)
 * or by a tail only one path ends in (`main.ts` when there's one, `two-fronts/src/main.ts` when there are
 * several). A word with no dot or slash in it names nothing, so "main" isn't `main`.
 */
export function taskFiles(task: string, paths: string[]): string[] {
  const out = new Set<string>();
  for (const raw of task.match(/[\w@.\/-]+/g) ?? []) {
    const word = raw.replace(/^\.\//, "").replace(/[.\/-]+$/, "");
    if (!/[./]/.test(word)) continue;
    const hits = paths.filter((p) => p === word || p.endsWith(`/${word}`));
    if (hits.length === 1) out.add(hits[0]!);
  }
  return [...out].sort();
}

/** An open branch already rewriting some of a new task's files. */
export interface Busy { branch: string; files: string[] }

/** The open branches that change any of `files`, the one sharing the most first: what a new task would wait for, or stack on. */
export function busyOn(files: string[], changed: { branch: string; path: string }[]): Busy[] {
  const want = new Set(files), by = new Map<string, string[]>();
  for (const c of changed) if (want.has(c.path)) by.set(c.branch, [...by.get(c.branch) ?? [], c.path]);
  return [...by].map(([branch, f]) => ({ branch, files: [...new Set(f)].sort() }))
    .sort((a, b) => b.files.length - a.files.length || a.branch.localeCompare(b.branch));
}
