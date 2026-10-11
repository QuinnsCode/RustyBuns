-- External CI (src/gh-compat.ts): tools that report to GitHub's API can point at ours instead.
-- Their runs are `external`, told apart from `github` and our own runners. SQLite can't widen a
-- CHECK in place, so check_runs is copied into a table that allows it.
CREATE TABLE check_runs_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  ref TEXT NOT NULL,
  sha TEXT NOT NULL,
  name TEXT NOT NULL,
  runner TEXT NOT NULL CHECK (runner IN ('desktop', 'container', 'github', 'external')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'passed', 'failed', 'cancelled')),
  started_at INTEGER, finished_at INTEGER,
  log TEXT NOT NULL DEFAULT '',
  junit TEXT,
  url TEXT,
  external_id TEXT,                 -- GitHub's id for an imported job, or status:<context> for an external one
  created_at INTEGER NOT NULL
);
INSERT INTO check_runs_next (id, owner, repo, ref, sha, name, runner, status, started_at, finished_at, log, junit, url, external_id, created_at)
  SELECT id, owner, repo, ref, sha, name, runner, status, started_at, finished_at, log, junit, url, external_id, created_at FROM check_runs;
DROP TABLE check_runs;
ALTER TABLE check_runs_next RENAME TO check_runs;
CREATE INDEX check_runs_by_ref ON check_runs (owner, repo, ref, id);
CREATE INDEX check_runs_by_sha ON check_runs (owner, repo, sha, external_id);

-- A repo's CI tokens: what an external CI sends as its GitHub token. Each reaches one repo's
-- checks and nothing else. Only the SHA-256 is kept; the secret is shown once.
CREATE TABLE ci_tokens (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  label TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  last4 TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX ci_tokens_by_repo ON ci_tokens (owner, repo);
