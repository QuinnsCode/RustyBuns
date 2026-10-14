// Mervin knows what a PR can break (#1520): its blast radius, from the workspaces' package.json files and the
// lockfile, the way scripts/ci-apps.ts decides what CI reruns. A `packages/` change, the lockfile or a root
// dependency change reaches every workspace; a change to one workspace reaches the ones that depend on it.
// The board stacks the widest PRs last (`rank`) so a major bump or a shared-package change is tested by itself,
// and `flags` names a major bump with no migration notes and a bump two PRs make to different versions.
//
// The core is pure (`blast`, `rank`, `flags`); `load` is the only part that reads git.

export interface Pkg { dir: string; name: string; deps: Record<string, string> }
export interface Bump { pkg: string; dir: string; from: string | null; to: string | null; major: boolean }
export interface Blast { pr: number; workspaces: string[]; files: number; tests: number; shared: boolean; bumps: Bump[]; score: number }
export interface Change { pr: number; body?: string; files: string[]; manifests: { dir: string; before: Pkg | null; after: Pkg | null }[] }

const ROOT = ".";
export const workspaceOf = (path: string) => path.match(/^((?:apps|packages)\/[^/]+)\//)?.[1] ?? ROOT;
const TEST = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const NOTES = /migrat|breaking|upgrad|changelog|release notes/i;

const num = (v: string) => (v.match(/\d+(\.\d+)*/)?.[0] ?? "").split(".").map(Number);
/** A major bump: the first number moves, or for 0.x the second does (the range semver treats as breaking). */
export function isMajor(from: string | null, to: string | null): boolean {
  if (!from || !to) return false;
  const [a = 0, b = 0] = num(from), [c = 0, d = 0] = num(to);
  return a !== c ? true : a === 0 && b !== d;
}

/** Workspaces that depend, directly or through others, on any of `dirs`. */
export function dependents(pkgs: Pkg[], dirs: string[]): string[] {
  const hit = new Set(dirs), names = new Map(pkgs.map((p) => [p.name, p.dir]));
  for (let grew = true; grew;) {
    grew = false;
    for (const p of pkgs) {
      if (hit.has(p.dir)) continue;
      if (Object.keys(p.deps).some((d) => names.has(d) && hit.has(names.get(d)!))) { hit.add(p.dir); grew = true; }
    }
  }
  return [...hit];
}

/** `from` and `to` of every dependency one package.json adds, removes or moves (null on the missing side). */
export function bumpsOf(dir: string, before: Pkg | null, after: Pkg | null): Bump[] {
  const a = before?.deps ?? {}, b = after?.deps ?? {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter((k) => a[k] !== b[k]).map((pkg) => ({
    pkg, dir, from: a[pkg] ?? null, to: b[pkg] ?? null, major: isMajor(a[pkg] ?? null, b[pkg] ?? null),
  }));
}

/**
 * What one PR reaches. `tree` is every path in main, to count the files and tests of the reached workspaces.
 * `lock` marks a changed lockfile or root dependency (the whole repo).
 */
export function blast(c: Change, pkgs: Pkg[], tree: string[], lock = false): Blast {
  const all = pkgs.map((p) => p.dir).filter((d) => d !== ROOT);
  const touched = new Set(c.files.map(workspaceOf));
  const shared = lock || c.files.some((f) => f === "bun.lock") || [...touched].some((d) => d.startsWith("packages/"));
  const reached = shared ? all : dependents(pkgs, [...touched]).filter((d) => d !== ROOT);
  const inside = new Set(reached);
  const mine = tree.filter((f) => inside.has(workspaceOf(f)));
  const bumps = c.manifests.flatMap((m) => bumpsOf(m.dir, m.before, m.after));
  const files = mine.length, tests = mine.filter((f) => TEST.test(f)).length;
  // A major bump counts as much as a shared change: it can break a whole workspace on its own.
  const score = reached.length * 1000 + files + (shared ? 100000 : 0) + bumps.filter((b) => b.major).length * 50000;
  return { pr: c.pr, workspaces: reached.sort(), files, tests, shared, bumps, score };
}

/** Narrowest first, ties by number: the widest PRs land last, where a failure points at one PR. */
export const rank = (list: Blast[]): number[] => [...list].sort((a, b) => a.score - b.score || a.pr - b.pr).map((b) => b.pr);

/** Warnings: a major bump no PR text explains, and one package two PRs move to different versions. */
export function flags(changes: Change[], blasts: Blast[]): string[] {
  const out: string[] = [];
  const body = new Map(changes.map((c) => [c.pr, c.body ?? ""]));
  for (const b of blasts) for (const m of b.bumps.filter((x) => x.major && x.to))
    if (!NOTES.test(body.get(b.pr)!)) out.push(`#${b.pr} bumps ${m.pkg} ${m.from} to ${m.to} (major) with no migration notes`);
  const by = new Map<string, Map<string, number[]>>();
  for (const b of blasts) for (const m of b.bumps.filter((x) => x.to)) {
    const to = by.get(m.pkg) ?? new Map<string, number[]>();
    to.set(m.to!, [...(to.get(m.to!) ?? []), b.pr]); by.set(m.pkg, to);
  }
  for (const [pkg, to] of by) if (to.size > 1)
    out.push(`${pkg} is bumped to ${[...to].map(([v, prs]) => `${v} by ${prs.map((n) => `#${n}`).join(", ")}`).join(" and ")}`);
  return out;
}

export const describeBlast = (b: Blast): string =>
  `#${b.pr}: ${b.shared ? "every workspace" : `${b.workspaces.length} workspace${b.workspaces.length === 1 ? "" : "s"}`}, ${b.files} files, ${b.tests} tests`
  + (b.bumps.some((x) => x.major) ? `, major bump: ${b.bumps.filter((x) => x.major).map((x) => x.pkg).join(", ")}` : "");

type Git = (...a: string[]) => string | null;
const pkgAt = (git: Git, ref: string, dir: string): Pkg | null => {
  try {
    const j = JSON.parse(git("show", `${ref}:${dir === ROOT ? "" : `${dir}/`}package.json`) ?? "");
    return { dir, name: j.name ?? dir, deps: { ...j.devDependencies, ...j.dependencies } };
  } catch { return null; }
};

/** Reads git only: main's workspaces and paths, and each PR's changed files and package.json before and after. */
export function load(git: Git, main: string, prs: { number: number; body?: string; headRefOid: string }[]) {
  const tree = (git("ls-tree", "-r", "--name-only", main) ?? "").split("\n").filter(Boolean);
  const dirs = [ROOT, ...new Set(tree.map(workspaceOf).filter((d) => d !== ROOT))];
  const pkgs = dirs.map((d) => pkgAt(git, main, d)).filter((p): p is Pkg => !!p);
  const changes: Change[] = prs.map((p) => {
    const files = (git("diff", "--name-only", `${main}...${p.headRefOid}`) ?? "").split("\n").filter(Boolean);
    const manifests = files.filter((f) => /^((apps|packages)\/[^/]+\/)?package\.json$/.test(f))
      .map((f) => { const dir = f === "package.json" ? ROOT : f.slice(0, -"/package.json".length); return { dir, before: pkgAt(git, main, dir), after: pkgAt(git, p.headRefOid, dir) }; });
    return { pr: p.number, body: p.body, files, manifests };
  });
  // Root dependency edits reach everything; scripts and version edits don't.
  const blasts = changes.map((c) => blast(c, pkgs, tree, c.manifests.some((m) => m.dir === ROOT && bumpsOf(ROOT, m.before, m.after).length > 0)));
  return { changes, blasts, flags: flags(changes, blasts) };
}
