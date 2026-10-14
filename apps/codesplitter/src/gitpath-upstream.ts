// Layout: gitpath's history from before the repo was on codeSplitter, read from its GitHub upstream
// A repo dug from GitHub lands at depth 1 (github.ts), so its own git starts at the import and a file's history would
// begin there. gitpath is for seeing the code's whole story, so for a repo with a GitHub upstream the commits before the
// import come from GitHub's commit API (the ones that touched the file, with the lines each added and removed) and are
// joined onto the hosted ones. Anything GitHub won't say (private without a token, rate limited) leaves the hosted history as it is.

import type { Commit } from "./gitpath/gitpath.ts";
import { gh } from "./github.ts";
import { upstreamOf } from "./listen.ts";
import { inBatches } from "./util.ts";

/** How many commits get their line counts read, one request each; older ones keep 0/0. */
const DETAILS = 40;

interface Row { sha: string; commit: { message: string; author: { name?: string; date?: string } | null; committer: { date?: string } | null }; author: { login?: string } | null }
interface Detail { files?: { filename: string; additions: number; deletions: number }[] }

const getJson = async <T>(path: string, token?: string): Promise<T | null> => {
  try {
    const r = await gh(path, token);
    return r.ok ? (await r.json()) as T : null;
  } catch { return null; }
};

export interface UpstreamRepo { upstream: string | null; upstream_commit: string | null; branch: string | null }

/** Where to read, or null when the repo wasn't dug from GitHub. A dug folder's paths are prefixed with the folder. */
export function source(r: UpstreamRepo | null | undefined) {
  if (!r?.upstream || !r.upstream_commit) return null;
  const u = upstreamOf(r.upstream, r.branch);
  return u && { repo: u.repo, sha: r.upstream_commit, folder: u.folder };
}

/**
 * `path`'s commits on GitHub up to the commit the repo was dug at, newest first, in gitpath's shape and chained linearly
 * (GitHub's file history leaves out the merges). `more` says there were more than `limit`.
 */
export async function upstreamFileHistory(r: UpstreamRepo | null, path: string, limit: number, token?: string): Promise<{ commits: Commit[]; more: boolean } | null> {
  const s = source(r);
  if (!s) return null;
  const full = s.folder ? `${s.folder}/${path}` : path;
  const rows = await getJson<Row[]>(`/repos/${s.repo}/commits?sha=${s.sha}&path=${encodeURIComponent(full)}&per_page=${Math.min(100, limit + 1)}`, token);
  if (!rows) return null;
  const more = rows.length > limit;
  const kept = rows.slice(0, limit);
  const counts = new Map<string, { added: number; removed: number }>();
  await inBatches(kept.slice(0, DETAILS), async (row) => {
    const d = await getJson<Detail>(`/repos/${s.repo}/commits/${row.sha}`, token);
    const f = d?.files?.find((x) => x.filename === full);
    if (f) counts.set(row.sha, { added: f.additions, removed: f.deletions });
  });
  const commits = kept.map((row, k): Commit => ({
    hash: row.sha, author: row.commit.author?.name ?? row.author?.login ?? "unknown",
    date: new Date(row.commit.author?.date ?? row.commit.committer?.date ?? 0).toISOString(),
    subject: row.commit.message.split("\n")[0]!.slice(0, 200),
    added: counts.get(row.sha)?.added ?? 0, removed: counts.get(row.sha)?.removed ?? 0,
    parents: kept[k + 1] ? [kept[k + 1]!.sha] : [],
  }));
  return { commits, more };
}

/**
 * The hosted commits with GitHub's earlier ones behind them. The hosted history's oldest commit has nothing before it
 * (the import's root, which is also GitHub's commit when the import kept it), so it takes the next older GitHub commit
 * as its parent, and GitHub's counts for the same commit, since the root's own diff is the whole file.
 */
export function joinHistory(hosted: Commit[], before: Commit[]): Commit[] {
  if (!before.length) return hosted;
  const theirs = new Map(before.map((c) => [c.hash, c]));
  const have = new Set(hosted.map((c) => c.hash));
  const older = before.filter((c) => !have.has(c.hash));
  const joined = hosted.map((c): Commit => {
    if (c.parents?.length) return c;
    const same = theirs.get(c.hash);
    return { ...c, ...(same && { added: same.added, removed: same.removed }), parents: same ? same.parents : older[0] ? [older[0].hash] : [] };
  });
  return [...joined, ...older];
}

/** The files that changed in GitHub's latest commits up to the dig, counted, for a repo whose own git has few edits to show. */
export async function upstreamBusiest(r: UpstreamRepo | null, token?: string, commits = 30): Promise<Map<string, number> | null> {
  const s = source(r);
  if (!s) return null;
  const rows = await getJson<Row[]>(`/repos/${s.repo}/commits?sha=${s.sha}&per_page=${commits}`, token);
  if (!rows) return null;
  const counts = new Map<string, number>();
  const prefix = s.folder ? `${s.folder}/` : "";
  await inBatches(rows, async (row) => {
    const d = await getJson<Detail>(`/repos/${s.repo}/commits/${row.sha}`, token);
    if (!d?.files || d.files.length > 300) return;
    for (const f of d.files) {
      if (!f.filename.startsWith(prefix) || /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/.test(f.filename)) continue;
      const p = f.filename.slice(prefix.length);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  });
  return counts;
}
