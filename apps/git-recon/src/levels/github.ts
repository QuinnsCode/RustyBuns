// Any public repo, loaded at play time from GitHub into the same RepoSnapshot
// scripts/snapshot.ts writes, so it maps onto a level the same way:
//   the repo           its default branch
//   its last commits   the tip, and the files the latest few touched (churn) and whether agents made them
//   the tree           every file and its size; a line is about 32 bytes until its text is read
//   raw text           the biggest scripts and the package.json files, for the imports between folders
//   check runs         the ones failing at the tip, which set compounds on fire
// GitHub lets a browser make 60 API calls an hour without signing in; one load makes about a dozen
// (the raw text comes from raw.githubusercontent.com, which doesn't count), and a load is kept for half an hour.

import { folderOf, type RepoFile, type RepoSnapshot } from "../sim/codemap.ts";
import { folderLinks, isAgentCommit, isScript, MAX_FILES, SKIP, SOURCE, tally, workspacePackages } from "../sim/intel.ts";

/** Commits whose files are read for churn, scripts read for imports, and bytes a line is taken to be. */
export const DETAIL = 10, READ = 150, BYTES_PER_LINE = 32;
const API = "https://api.github.com", RAW = "https://raw.githubusercontent.com";

export class LoadError extends Error {}

/** "owner/repo", from that or a github.com URL, or null if it's neither. */
export function parseSlug(input: string): string | null {
  const m = input.trim().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "").match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

type Fetch = (url: string) => Promise<Response>;

async function api<T>(get: Fetch, path: string, slug: string): Promise<T> {
  const res = await get(`${API}${path}`);
  if (res.status === 404) throw new LoadError(`${slug} isn't a public repo on GitHub`);
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
    throw new LoadError(`GitHub's hourly limit for this browser is used up${reset ? `; it resets at ${new Date(reset).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`);
  }
  if (!res.ok) throw new LoadError(`GitHub said ${res.status} for ${slug}`);
  return res.json() as Promise<T>;
}

interface Commit { sha: string; commit: { message: string; author?: { name?: string } }; author?: { login?: string } | null; files?: { filename: string }[] }

export async function loadRepo(slug: string, get: Fetch = (u) => fetch(u)): Promise<RepoSnapshot> {
  const info = await api<{ default_branch: string; full_name: string }>(get, `/repos/${slug}`, slug);
  const name = info.full_name || slug;
  const recent = await api<Commit[]>(get, `/repos/${name}/commits?sha=${encodeURIComponent(info.default_branch)}&per_page=${DETAIL}`, name);
  const head = recent[0]?.sha;
  if (!head) throw new LoadError(`${name} has no commits`);

  const tree = await api<{ tree: { path: string; type: string; size?: number }[] }>(get, `/repos/${name}/git/trees/${head}?recursive=1`, name);
  const blobs = tree.tree.filter((t) => t.type === "blob");
  let files: RepoFile[] = blobs
    .filter((t) => SOURCE.test(t.path) && !SKIP.test(t.path) && (t.size ?? 0) > 0)
    .map((t) => ({ path: t.path, lines: Math.max(1, Math.round((t.size ?? 0) / BYTES_PER_LINE)) }))
    .sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES);
  if (!files.length) throw new LoadError(`${name} has no source files to fight through`);

  // The biggest scripts and every package.json: their real line counts, and the imports between folders.
  const raw = async (path: string) => {
    const res = await get(`${RAW}/${name}/${head}/${path.split("/").map(encodeURIComponent).join("/")}`).catch(() => null);
    return res?.ok ? { path, text: await res.text() } : null;
  };
  const read = files.filter((f) => isScript(f.path)).slice(0, READ).map((f) => f.path);
  const manifestPaths = blobs.filter((t) => /(^|\/)package\.json$/.test(t.path) && !SKIP.test(t.path)).slice(0, 40).map((t) => t.path);
  const readAll = async (ps: string[]) => (await Promise.all(ps.map(raw))).filter((x) => x !== null);
  const [sources, manifests] = await Promise.all([readAll(read), readAll(manifestPaths)]);
  const exact = new Map(sources.map((s) => [s.path, s.text.split("\n").length]));
  files = files.map((f) => (exact.has(f.path) ? { ...f, lines: exact.get(f.path)! } : f));
  const folders = new Set(files.map((f) => folderOf(f.path)));
  const links = folderLinks(sources, workspacePackages(manifests), folders);

  // The latest commits' files: churn, and the agents' share of it.
  const detail = await Promise.all(recent.map((c) => api<Commit>(get, `/repos/${name}/commits/${c.sha}`, name).catch(() => null)));
  const commits = detail.filter((c) => c !== null).map((c) => ({
    agent: isAgentCommit(c.commit.message, c.author?.login ?? c.commit.author?.name ?? ""),
    paths: (c.files ?? []).map((f) => f.filename),
  }));
  files = tally(files, commits).sort((a, b) => a.path.localeCompare(b.path));

  const checks = await api<{ check_runs: { name: string; status: string; conclusion: string | null }[] }>(get, `/repos/${name}/commits/${head}/check-runs?per_page=100`, name)
    .catch(() => ({ check_runs: [] }));
  const failing = [...new Set(checks.check_runs.filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out").map((r) => r.name))].sort();

  return { name, ref: head.slice(0, 7), files, links, failing };
}

/** A load kept in the browser for half an hour, so trying a level twice doesn't spend the hour's calls twice. */
const KEEP_MS = 30 * 60_000;
export async function loadRepoCached(slug: string): Promise<RepoSnapshot> {
  const key = `git-recon:repo:${slug.toLowerCase()}`;
  try {
    const kept = JSON.parse(localStorage.getItem(key) ?? "null") as { at: number; repo: RepoSnapshot } | null;
    if (kept && Date.now() - kept.at < KEEP_MS) return kept.repo;
  } catch {}
  const repo = await loadRepo(slug);
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), repo })); } catch {}
  return repo;
}
