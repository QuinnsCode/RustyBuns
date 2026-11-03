-- The pipeline's hooks at a merge (src/pipeline-hooks.ts, #3313): each hook's yay, nay or waiting card on a branch,
-- kept against the branch's hash so an edit asks again.
CREATE TABLE IF NOT EXISTS hook_verdicts (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  hook TEXT NOT NULL,
  hash TEXT NOT NULL,
  say TEXT NOT NULL,
  by TEXT NOT NULL DEFAULT '',
  reason TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, branch, hook)
);
