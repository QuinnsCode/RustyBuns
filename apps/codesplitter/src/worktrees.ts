// Layout: real checkouts (`git worktree add`) off a desktop repo's bare git, per branch or per run, cleaned up when done
// Worktrees: real checkouts off a desktop repo's bare git (#464). The way
// Agent Office gives every worker its own git worktree, an agent, a runner or
// your own tools can ask for a directory with a branch (or a run's commit)
// checked out, made with `git worktree add` off the bare repo in ~/.codesplitters,
// and work in it like any clone. Commits there land straight in the repo's git:
// on its branch, or nowhere for a detached run.
//
// The default branch never gets a branch worktree: the app moves it by itself
// (commits from open files, mirror syncs), and a checkout of it would go stale
// underneath you. Ask for its commit (a detached run) or start a branch off it.
//
// Clean-up: a run's worktree goes when the run ends (DELETE it), or after a day.
// A branch's goes once the branch has commits of its own and main holds all of
// them (it merged), or the branch is gone. One with changes not committed stays.
//
//   GET    /api/repos/:o/:r/worktrees                      (owner) the repo's worktrees, after clean-up
//   POST   /api/repos/:o/:r/worktrees {branch, from?} | {sha}
//          (owner) a worktree for git branch `branch` (made off `from`, default main, if new),
//          or detached at `sha` for a run: {name, path, branch, sha}
//   DELETE /api/repos/:o/:r/worktrees/:name                (owner) remove it; its branch stays

import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { git, localGit } from "./mirror.ts";
import { json, readBody, type Env } from "./env.ts";
import { repoRow } from "./repos.ts";

/** How long a run's worktree is kept if nobody removes it. */
export const RUN_TTL = 24 * 3600_000;

/** Where a bare repo's worktrees go: beside the repos, out of the way of the ones Artifacts lists (*.git). */
export const worktreeRoot = (bare: string) => join(dirname(bare), ".worktrees", bare.replace(/^.*\//, "").replace(/\.git$/, ""));

const isSha = (s: string) => /^[0-9a-f]{40}$/.test(s);
/** A worktree's directory name: the branch's, with folders flattened, or run-<sha>. */
export const worktreeName = (o: { branch?: string; sha?: string }) => o.branch ? o.branch.replace(/\//g, "--") : `run-${o.sha!.slice(0, 12)}`;

type Made = { name: string; path: string; branch: string | null; sha: string; base: string | null };

/**
 * A worktree off `bare`: branch `branch` checked out (made off `from` if git
 * has no such branch yet), or detached at `sha`. Throws with git's words.
 */
export async function addWorktree(bare: string, o: { branch?: string; from?: string; sha?: string }): Promise<Made> {
  const name = worktreeName(o), path = join(worktreeRoot(bare), name);
  if (existsSync(path)) throw Object.assign(new Error(`there's a worktree at ${path} already`), { status: 409 });
  const run = async (args: string[]) => { const r = await git(args, bare); if (r.code) throw new Error(r.err || `git ${args[0]} exited ${r.code}`); return r.out.trim(); };
  await git(["worktree", "prune"], bare);
  if (o.branch) {
    const has = (await git(["rev-parse", "--verify", "--quiet", `refs/heads/${o.branch}^{commit}`], bare)).code === 0;
    if (has) await run(["worktree", "add", "--quiet", path, o.branch]);
    else await run(["worktree", "add", "--quiet", "-b", o.branch, path, o.from ?? "HEAD"]);
    const sha = await run(["rev-parse", `refs/heads/${o.branch}`]);
    return { name, path, branch: o.branch, sha, base: sha };
  }
  await run(["worktree", "add", "--quiet", "--detach", path, o.sha!]);
  return { name, path, branch: null, sha: o.sha!, base: null };
}

/** Take a worktree away, changes and all; its branch (if any) stays in the bare repo. */
export async function removeWorktree(bare: string, path: string) {
  const r = await git(["worktree", "remove", "--force", "--force", path], bare);
  if (r.code) rmSync(path, { recursive: true, force: true });
  await git(["worktree", "prune"], bare);
}

/** Whether a worktree has changes nobody committed. */
const dirty = async (path: string) => {
  const r = await git(["status", "--porcelain"], path);
  return r.code === 0 && r.out.trim() !== "";
};

/**
 * Whether a worktree is done with: a run's after RUN_TTL, a branch's once its
 * branch is gone, or has moved past where it started and `main` holds all of it.
 * One with uncommitted changes never is, nor one whose directory went (that's pruned).
 */
export async function finished(bare: string, w: { branch: string | null; base: string | null; path: string; created_at: number }, main: string, now = Date.now()) {
  if (!existsSync(w.path)) return true;
  if (await dirty(w.path)) return false;
  if (!w.branch) return now - w.created_at > RUN_TTL;
  const tip = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${w.branch}^{commit}`], bare);
  if (tip.code) return true;
  if (tip.out.trim() === w.base) return false;
  return (await git(["merge-base", "--is-ancestor", tip.out.trim(), `refs/heads/${main}`], bare)).code === 0;
}

type Row = { name: string; branch: string | null; sha: string; base: string | null; path: string; created_at: number };
type Repo = { artifact: string | null; branch: string | null; crew_artifact: string | null };
const repoOf = (env: Env, owner: string, repo: string) => repoRow<Repo>(env, owner, repo, "artifact, branch, crew_artifact");

/** Remove the repo's worktrees that are done with (see finished): after each mirror sync, and on every list. */
export async function pruneWorktrees(env: Env, owner: string, repo: string, now = Date.now()) {
  const lg = localGit(env), r = await repoOf(env, owner, repo);
  if (!lg || !r?.artifact) return;
  const bare = lg.path(r.artifact);
  const { results } = await env.DB.prepare("SELECT name, branch, sha, base, path, created_at FROM worktrees WHERE owner = ? AND repo = ?").bind(owner, repo).all();
  for (const w of results as Row[]) {
    if (!(await finished(bare, w, r.branch ?? "main", now))) continue;
    await removeWorktree(bare, w.path);
    await env.DB.prepare("DELETE FROM worktrees WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, w.name).run();
  }
}

/** Every worktree of a repo that's being deleted (github.ts evict), before its git goes. */
export async function dropWorktrees(env: Env, owner: string, repo: string) {
  const lg = localGit(env), r = await repoOf(env, owner, repo);
  if (!lg || !r?.artifact) return;
  rmSync(worktreeRoot(lg.path(r.artifact)), { recursive: true, force: true });
}

/** /api/repos/:o/:r/worktrees[/:name], desktop only, for the repo's owner. */
export async function worktreeRoute(req: Request, env: Env, p: string[], owner: string, repo: string, user: string | null) {
  if (p[4] !== "worktrees" || p[6]) return null;
  if (user !== owner) return json({ error: "owner only" }, 403);
  const lg = localGit(env), r = await repoOf(env, owner, repo);
  if (!lg) return json({ error: "worktrees need the repo's git on your machine: the desktop app" }, 501);
  if (!r?.artifact) return json({ error: "this repo has no git yet: commit something first" }, 409);
  // Private lines are blank in this git; a checkout of it would read as if they were gone.
  if (r.crew_artifact) return json({ error: "this repo has private lines, and its git holds them blank" }, 409);
  const bare = lg.path(r.artifact), main = r.branch ?? "main";
  const list = async () => {
    await pruneWorktrees(env, owner, repo);
    const { results } = await env.DB.prepare("SELECT name, branch, sha, path, created_at FROM worktrees WHERE owner = ? AND repo = ? ORDER BY created_at").bind(owner, repo).all();
    return results;
  };

  if (req.method === "GET" && !p[5]) return json(await list());
  if (req.method === "DELETE" && p[5]) {
    const w = await env.DB.prepare("SELECT path FROM worktrees WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, p[5]).first();
    if (!w) return json({ error: "no such worktree" }, 404);
    await removeWorktree(bare, w.path as string);
    await env.DB.prepare("DELETE FROM worktrees WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, p[5]).run();
    return json({ removed: p[5] });
  }
  if (req.method !== "POST" || p[5]) return null;

  const b = await readBody<"branch" | "from" | "sha">(req);
  const branch = typeof b.branch === "string" ? b.branch : undefined, sha = typeof b.sha === "string" ? b.sha : undefined;
  if (!branch === !sha) return json({ error: "give a git branch, or a sha for a run" }, 400);
  if (b.from !== undefined && (typeof b.from !== "string" || !branch || b.from.startsWith("-"))) return json({ error: "from: a branch or commit to start a new branch off" }, 400);
  if (branch) {
    if (branch === main) return json({ error: `${main} moves by itself here: ask for its commit (sha), or start a branch off it` }, 409);
    if ((await git(["check-ref-format", "--branch", branch])).code || branch.startsWith("-")) return json({ error: "bad branch name" }, 400);
  } else {
    if (!isSha(sha!) || (await git(["cat-file", "-e", `${sha}^{commit}`], bare)).code) return json({ error: `${sha} isn't a commit in the repo's git` }, 404);
  }
  // Rows whose directory went, and worktrees done with, go first: their names are free again.
  await pruneWorktrees(env, owner, repo);
  try {
    const w = await addWorktree(bare, { branch, sha, from: branch ? (b.from as string | undefined) ?? `refs/heads/${main}` : undefined });
    await env.DB.prepare("INSERT INTO worktrees (owner, repo, name, branch, sha, base, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(owner, repo, w.name, w.branch, w.sha, w.base, w.path, Date.now()).run();
    return json({ name: w.name, path: w.path, branch: w.branch, sha: w.sha }, 201);
  } catch (e) {
    const err = e as Error & { status?: number };
    return json({ error: err.message }, err.status ?? 409);
  }
}
