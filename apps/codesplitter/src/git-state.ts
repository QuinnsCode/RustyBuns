// Layout: every git state of a repo in one answer, for the bar on the repo page
// Where this repo's git stands, at a glance:
//
//   mirror      mirrored from a remote? in step, down, refused, clash, rewritten, held; pull-only; which side leads
//   out         commits here that upstream hasn't (ahead), and files committed here that git hasn't taken yet
//   in          commits upstream has that we don't (behind; for a dug repo, new commits since the dig)
//   uncommitted files with edits no commit has taken (the `uncommitted` table)
//   conflicts   a mirror clash or rewrite, and files a push to git clashed with
//
//   GET /api/repos/:o/:r/git-state

import type { Env } from "./env.ts";
import { mirrorStatus } from "./mirror.ts";
import { repoRow } from "./repos.ts";

/** How many uncommitted paths the answer names; the count is always whole. */
const NAMED = 30;

export async function gitState(env: Env, owner: string, repo: string) {
  const r = await repoRow<{ upstream: string | null; upstream_commit: string | null; upstream_tip: string | null; upstream_behind: number | null; upstream_heard_at: number | null; git_error: string | null; git_clash: string | null }>(env, owner, repo, "upstream, upstream_commit, upstream_tip, upstream_behind, upstream_heard_at, git_error, git_clash");
  const [mirror, count, named, waiting] = await Promise.all([
    mirrorStatus(env, owner, repo).catch(() => null),
    env.DB.prepare("SELECT COUNT(*) AS n FROM uncommitted u JOIN files f ON f.owner = u.owner AND f.repo = u.repo AND f.path = u.path WHERE u.owner = ? AND u.repo = ?").bind(owner, repo).first<{ n: number }>(),
    env.DB.prepare("SELECT u.path, u.since FROM uncommitted u JOIN files f ON f.owner = u.owner AND f.repo = u.repo AND f.path = u.path WHERE u.owner = ? AND u.repo = ? ORDER BY u.since DESC LIMIT ?").bind(owner, repo, NAMED).all<{ path: string; since: number }>(),
    env.DB.prepare("SELECT path FROM git_pending WHERE owner = ? AND repo = ? ORDER BY path").bind(owner, repo).all<{ path: string }>(),
  ]);
  let pushClash: string[] = [];
  try { pushClash = Object.keys(r?.git_clash ? JSON.parse(r.git_clash) : {}); } catch {}
  // A dug repo (no mirror) hears from GitHub on a timer: new commits there are waiting to come in.
  const dug = r?.upstream?.startsWith("github:") && !mirror
    ? { moved: !!r.upstream_tip && r.upstream_tip !== r.upstream_commit, behind: r.upstream_behind, heardAt: r.upstream_heard_at }
    : null;
  return {
    mirror: mirror && {
      url: mirror.url, branch: mirror.branch, state: mirror.state, pullOnly: mirror.pullOnly, primary: mirror.primary, held: mirror.state === "held",
      ahead: mirror.ahead, behind: mirror.behind, syncedAt: mirror.syncedAt, downSince: mirror.downSince, error: mirror.error,
    },
    dug,
    uncommitted: { count: count?.n ?? 0, files: named.results },
    waitingForGit: waiting.results.map((x) => x.path),
    gitError: r?.git_error ?? null,
    conflicts: { mirror: mirror && (mirror.state === "clash" || mirror.state === "rewritten") ? { state: mirror.state, files: mirror.clash } : null, push: pushClash },
  };
}
