// Layout: folder mirrors: one folder of a monorepo kept in step as a repo of its own, both ways
// A folder mirror (repos.mirror_path) is a mirror of one folder of upstream, made the repo's root: apps/codesplitter
// out of a monorepo, say. mirror.ts runs it like any mirror, with two swaps:
//
//   - Hearing: upstream's whole branch is fetched to refs/folder-source/<branch>, and each upstream commit since the
//     last one taken that touched the folder becomes a commit of the folder alone, with its author, date and message
//     (and an Upstream-commit trailer). That split history is what the mirror sees as upstream (refs/upstream/<branch>);
//     refs/folder-split/<branch> is the upstream commit it stands for, where the next sync splits from.
//   - Sending: this copy's work goes back under the folder's path, on top of upstream's tip, as one commit on a branch
//     of its own (codesplitter/<repo>), for a pull request. Never to upstream's main: a monorepo's main takes changes
//     through its own review. That branch is this copy's alone, so a new send replaces it. Once upstream takes it, the
//     split brings the same files back and the mirror is in step again.

type Run = { code: number; out: string; err: string };
export type Git = (args: string[], cwd?: string, env?: Record<string, string>) => Promise<Run>;

export const sourceRef = (branch: string) => `refs/folder-source/${branch}`;
export const splitFromRef = (branch: string) => `refs/folder-split/${branch}`;
/** The upstream branch a folder mirror sends its work to. */
/** The upstream root's lockfile and the workspace packages the folder depends on, kept as a read-only tree beside the folder. */
export const depsRef = (branch: string) => `refs/folder-deps/${branch}`;
export const sendBranch = (repo: string) => `codesplitter/${repo}`;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** A folder path as stored: no leading or trailing slashes, no `.` or `..` parts. Null when it isn't one. */
export function folderPath(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const parts = s.split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === ".." || p.startsWith(".git"))) return null;
  return parts.join("/");
}

async function out(git: Git, dir: string, args: string[], env?: Record<string, string>) {
  const r = await git(args, dir, env);
  if (r.code) throw new Error(r.err || `git ${args[0]} exited ${r.code}`);
  return r.out.trim();
}

/** The env that makes a commit carry upstream commit `c`'s author and committer, and its message. */
async function metaOf(git: Git, dir: string, c: string) {
  const [an, ae, ad, cn, ce, cd, ...body] = (await out(git, dir, ["log", "-1", "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B", c])).split("\0");
  return {
    env: { GIT_AUTHOR_NAME: an!, GIT_AUTHOR_EMAIL: ae!, GIT_AUTHOR_DATE: ad!, GIT_COMMITTER_NAME: cn!, GIT_COMMITTER_EMAIL: ce!, GIT_COMMITTER_DATE: cd! },
    message: body.join("\0").trim(),
  };
}

/**
 * Upstream's commits that touched `path` after `from` up to `to` (first parent: the mainline), each as a commit of the
 * folder alone on top of `tip`. With no `from` (a new mirror, or an upstream that rewrote its history), one commit of
 * the folder as `to` has it. Null when `to` has no such folder.
 */
export async function split(git: Git, dir: string, path: string, from: string | null, to: string, tip: string | null): Promise<string | null> {
  const treeAt = async (c: string) => { const r = await git(["rev-parse", "--verify", "--quiet", `${c}:${path}`], dir); return r.code ? null : r.out.trim(); };
  if (!from || !tip) {
    const tree = await treeAt(to);
    if (!tree) return null;
    const m = await metaOf(git, dir, to);
    return out(git, dir, ["commit-tree", tree, "-m", `${path} at ${to.slice(0, 7)}\n\nUpstream-commit: ${to}`], m.env);
  }
  const list = (await out(git, dir, ["rev-list", "--reverse", "--first-parent", `${from}..${to}`, "--", path])).split("\n").filter(Boolean);
  let at = await out(git, dir, ["rev-parse", `${tip}^{tree}`]);
  for (const c of list) {
    const tree = await treeAt(c);
    if (!tree) return null;
    if (tree === at) continue;
    const m = await metaOf(git, dir, c);
    tip = await out(git, dir, ["commit-tree", tree, "-p", tip, "-m", `${m.message}\n\nUpstream-commit: ${c}`], m.env);
    at = tree;
  }
  return tip;
}

/** `git mktree -z` with `entries` ("mode type sha\tname") on stdin. */
async function mktree(dir: string, entries: string[]) {
  const p = Bun.spawn(["git", "mktree", "-z"], { cwd: dir, stdin: new Blob([entries.map((e) => `${e}\0`).join("")]), stdout: "pipe", stderr: "pipe" });
  const [code, o, e] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if (code) throw new Error(e.trim() || "git mktree failed");
  return o.trim();
}

/** Tree `root` with the folder at `parts` swapped for tree `sub`, as a new tree. */
async function swap(git: Git, dir: string, root: string, parts: string[], sub: string): Promise<string> {
  const [name, ...rest] = parts as [string, ...string[]];
  const entries = (await out(git, dir, ["ls-tree", "-z", root])).split("\0").filter(Boolean);
  const here = entries.find((e) => e.slice(e.indexOf("\t") + 1) === name);
  const was = here?.split(/\s/)[1] === "tree" ? here.split(/\s/)[2]! : EMPTY_TREE;
  const next = rest.length ? await swap(git, dir, was, rest, sub) : sub;
  return mktree(dir, [...entries.filter((e) => e !== here), `040000 tree ${next}\t${name}`]);
}

/** Upstream commit `onto`'s tree, with `path` as this copy's commit `ours` has it: the tree to send, or null when it's the same. */
export async function graft(git: Git, dir: string, path: string, onto: string, ours: string): Promise<string | null> {
  const [root, mine] = await Promise.all([out(git, dir, ["rev-parse", `${onto}^{tree}`]), out(git, dir, ["rev-parse", `${ours}^{tree}`])]);
  const tree = await swap(git, dir, root, path.split("/"), mine);
  return tree === root ? null : tree;
}

const ROOT_FILES = ["package.json", "bun.lock", "bun.lockb", "bunfig.toml"];

/** `git show <rev>:<path>` parsed as JSON, or null when it isn't there or isn't JSON. */
async function jsonAt(git: Git, dir: string, rev: string, path: string): Promise<any | null> {
  const r = await git(["show", `${rev}:${path}`], dir);
  if (r.code) return null;
  try { return JSON.parse(r.out); } catch { return null; }
}

/**
 * The workspace packages outside `path` that the folder depends on (through `workspace:` ranges, and theirs in turn), as
 * upstream's commit `source` has them: their folders, sorted. The root's `workspaces` say where packages live; a pattern
 * is a folder or `dir/*`.
 */
export async function workspaceDeps(git: Git, dir: string, path: string, source: string): Promise<string[]> {
  const root = await jsonAt(git, dir, source, "package.json");
  const globs: unknown = Array.isArray(root?.workspaces) ? root.workspaces : root?.workspaces?.packages;
  if (!Array.isArray(globs)) return [];
  const byName = new Map<string, string>();
  for (const g of globs) {
    if (typeof g !== "string" || g.startsWith("!")) continue;
    const base = g.replace(/\/$/, "");
    const dirs = base.endsWith("/*")
      ? (await git(["ls-tree", "--name-only", "-d", `${source}:${base.slice(0, -2)}`], dir)).out.split("\n").filter(Boolean).map((n) => `${base.slice(0, -2)}/${n}`)
      : [base];
    for (const d of dirs) {
      const name = (await jsonAt(git, dir, source, `${d}/package.json`))?.name;
      if (typeof name === "string") byName.set(name, d);
    }
  }
  const seen = new Set<string>(), todo = [path];
  while (todo.length) {
    const pkg = await jsonAt(git, dir, source, `${todo.pop()}/package.json`);
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, range] of Object.entries<unknown>(pkg?.[field] ?? {})) {
        const d = byName.get(name);
        if (d && d !== path && typeof range === "string" && range.startsWith("workspace:") && !seen.has(d)) { seen.add(d); todo.push(d); }
      }
    }
  }
  return [...seen].sort();
}

/** A tree of upstream commit `source`'s root manifest and lockfile plus the `deps` folders, at their own paths. Null when there are none. */
export async function depsTree(git: Git, dir: string, source: string, deps: string[]): Promise<string | null> {
  if (!deps.length) return null;
  const entries: string[] = [];
  for (const f of ROOT_FILES) {
    const sha = await git(["rev-parse", "--verify", "--quiet", `${source}:${f}`], dir);
    if (!sha.code) entries.push(`100644 blob ${sha.out.trim()}\t${f}`);
  }
  let tree = await mktree(dir, entries);
  for (const d of deps) tree = await swap(git, dir, tree, d.split("/"), await out(git, dir, ["rev-parse", `${source}:${d}`]));
  return tree;
}
