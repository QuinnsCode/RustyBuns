-- Which side of a mirror leads (#464): 'here' (the desktop's bare repo is the
-- source of truth and syncs push first) or NULL / 'upstream' (GitHub-first, as before).
ALTER TABLE repos ADD COLUMN mirror_primary TEXT;

-- Real checkouts off a desktop repo's bare git (#464): `git worktree add`, one
-- per branch or per run, so agents and runners work in a directory. `base` is
-- where a branch started, so a branch merged into main after that is cleaned up.
CREATE TABLE worktrees (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  name TEXT NOT NULL,          -- its directory's name: the branch's, or run-<sha>
  branch TEXT,                 -- the git branch it has checked out; NULL: detached at sha (a run)
  sha TEXT NOT NULL,           -- the commit it started at
  base TEXT,                   -- for a branch: where it stood when the worktree was made
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, name)
);
