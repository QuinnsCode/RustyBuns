// Layout: gitpath's data for a hosted repo: a file's commits with parents and line counts, and the repo's busiest files
// What `GET /api/repos/:o/:r/gitpath` answers with, read from the repo's git the way scripts/gitpath-log.ts reads a
// clone's: the commit graph (graph.ts) cut down to the commits that touched one file, each with the lines it added
// and removed and the nearest earlier commits that touched it too. A file is followed by its path, so a rename starts
// a new history. It reads trees to find which commits changed the file, and blobs only for those.

import type { ArtifactsRepo, TreeEntry } from "./env.ts";
import { graphRows } from "./graph.ts";
import { keptAncestors, simplifyParents, type Commit } from "./gitpath/gitpath.ts";
import { keptPairs } from "./sync.ts";
import { inBatches } from "./util.ts";

type Handle = Pick<ArtifactsRepo, "log" | "readCommit" | "readTree" | "readBlob">;

/** Past this a file is counted as changed but its lines aren't (a big or binary file). */
const MAX_BYTES = 512 * 1024;
/** How many reads go at once. */
/** A commit that changes more files than this is an import, not an edit, and doesn't count toward the busiest files. */
const MAX_CHANGED = 300;
const LOCKFILE = /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/;

/** Reads of one repo's trees, commits and blobs, each once. */
function reader(h: Handle, known: Map<string, { treeHash: string }>) {
  const trees = new Map<string, Promise<TreeEntry[] | null>>(), roots = new Map<string, Promise<string | null>>(), texts = new Map<string, Promise<string | null>>();
  const tree = (hash: string) => trees.get(hash) ?? trees.set(hash, h.readTree(hash).catch(() => null)).get(hash)!;
  /** A commit's root tree: from the walk if it was in it, else read. */
  const root = (hash: string) => roots.get(hash) ?? roots.set(hash, Promise.resolve(known.get(hash)?.treeHash ?? h.readCommit(hash).then((c) => c?.treeHash ?? null, () => null))).get(hash)!;
  /** The blob a path names in a tree, or null if there is no file there. */
  const blobIn = async (rootTree: string | null, parts: string[]): Promise<string | null> => {
    let at = rootTree;
    for (let k = 0; at && k < parts.length; k++) {
      const e = (await tree(at))?.find((x) => x.name === parts[k]);
      if (!e) return null;
      if (k === parts.length - 1) return e.type === "blob" || e.type === "exec" ? e.hash : null;
      at = e.type === "tree" ? e.hash : null;
    }
    return null;
  };
  /** A blob's text, or null for one that is too big or not text. */
  const text = (hash: string) => texts.get(hash) ?? texts.set(hash, (async () => {
    const b = await h.readBlob(hash).catch(() => null);
    if (!b || b.size > MAX_BYTES) return null;
    const t = await b.text();
    return t.includes("\0") ? null : t;
  })()).get(hash)!;
  return { tree, root, blobIn, text };
}

const lines = (s: string) => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));

/** Lines a change added and removed, by a longest common subsequence of the two texts. */
export function countLines(before: string, after: string): { added: number; removed: number } {
  const x = lines(before), y = lines(after);
  const kept = keptPairs(x, y).length;
  return { added: y.length - kept, removed: x.length - kept };
}

export interface FileHistory { branch: string; path: string; commits: Commit[]; more: boolean }

/**
 * `path`'s history on `branch`: of the last `limit` commits on it (and the side branches merged into them), the ones that
 * changed the file, newest first, in gitpath's own shape. A merge isn't one of them, but the lines it joined stay joined.
 */
export async function fileHistory(h: Handle, branch: string, path: string, limit = 100): Promise<FileHistory> {
  const parts = path.split("/").filter(Boolean);
  const { rows, known, more } = await graphRows(h, branch, limit);
  const read = reader(h, known);
  const at = new Map<string, Promise<string | null>>();
  const blobAt = (hash: string) => at.get(hash) ?? at.set(hash, read.root(hash).then((r) => read.blobIn(r, parts))).get(hash)!;
  const changed = (await inBatches(rows.map((r) => r.c).filter((c) => c.parents.length <= 1), async (c) => {
    const [now, before] = await Promise.all([blobAt(c.hash), c.parents[0] ? blobAt(c.parents[0]) : Promise.resolve(null)]);
    return now !== before ? { c, now, before } : null;
  })).filter((x): x is NonNullable<typeof x> => !!x);
  const counted = await inBatches(changed, async ({ c, now, before }) => {
    const [a, b] = await Promise.all([before ? read.text(before) : "", now ? read.text(now) : ""]);
    return { c, ...(a === null || b === null ? { added: 0, removed: 0 } : countLines(a, b)) };
  });
  const keep = new Set(counted.map((x) => x.c.hash));
  const dag = new Map([...known].map(([hash, c]) => [hash, c.parents]));
  const parents = simplifyParents(dag, keep);
  // The branch's tip often didn't touch the file: label the nearest commit that did.
  const tip = rows[0] ? keptAncestors(dag, keep)(rows[0].c.hash)[0] : undefined;
  const commits = counted.map(({ c, added, removed }): Commit => ({
    hash: c.hash, author: c.author.name, date: new Date(c.authoredAt < 1e12 ? c.authoredAt * 1000 : c.authoredAt).toISOString(),
    subject: c.message.split("\n")[0]!.slice(0, 200), added, removed, parents: parents.get(c.hash) ?? [],
    ...(c.hash === tip && { refs: [branch] }),
  }));
  return { branch, path: parts.join("/"), commits, more };
}

/**
 * The files most often changed in the last `limit` commits on `branch`, found by comparing each commit's tree to its
 * parent's (only the folders that differ are opened). Lockfiles, and commits that change hundreds of files, don't count.
 */
export async function busiestFiles(h: Handle, branch: string, limit = 60, top = 12): Promise<{ branch: string; files: { path: string; commits: number }[]; more: boolean }> {
  const { rows, known, more } = await graphRows(h, branch, limit);
  const read = reader(h, known);
  /** The files that differ between two trees, or null once there are too many. */
  const differ = async (a: string | null, b: string | null, dir: string, out: string[]): Promise<boolean> => {
    const [ea, eb] = await Promise.all([a ? read.tree(a) : null, b ? read.tree(b) : null]);
    const left = new Map((ea ?? []).map((e) => [e.name, e])), right = new Map((eb ?? []).map((e) => [e.name, e]));
    for (const name of new Set([...left.keys(), ...right.keys()])) {
      const x = left.get(name), y = right.get(name), path = dir ? `${dir}/${name}` : name;
      if (x?.hash === y?.hash) continue;
      const xt = x?.type === "tree" ? x.hash : null, yt = y?.type === "tree" ? y.hash : null;
      if (xt || yt) { if (!(await differ(xt, yt, path, out))) return false; }
      if ((x && !xt) || (y && !yt)) out.push(path);
      if (out.length > MAX_CHANGED) return false;
    }
    return true;
  };
  const counts = new Map<string, number>();
  await inBatches(rows.map((r) => r.c).filter((c) => c.parents.length === 1), async (c) => {
    const out: string[] = [];
    if (!(await differ(await read.root(c.parents[0]!), c.treeHash, "", out))) return;
    for (const p of out) if (!LOCKFILE.test(p)) counts.set(p, (counts.get(p) ?? 0) + 1);
  });
  const files = [...counts].map(([path, commits]) => ({ path, commits })).sort((x, y) => y.commits - x.commits || (x.path < y.path ? -1 : 1)).slice(0, top);
  return { branch, files, more };
}
