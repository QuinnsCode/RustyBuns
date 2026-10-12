-- Check runs (src/checks.ts): one record per job that says whether a change is good, wherever
-- it ran. Our own runners (#463) write `desktop` and `container` runs; GitHub Actions jobs for a
-- sha the mirror sent up come back in as `github` runs. A merge waits on the required ones.
CREATE TABLE check_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  ref TEXT NOT NULL,                -- 'main' or a branch's name
  sha TEXT NOT NULL,
  name TEXT NOT NULL,
  runner TEXT NOT NULL CHECK (runner IN ('desktop', 'container', 'github')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'passed', 'failed', 'cancelled')),
  started_at INTEGER, finished_at INTEGER,
  log TEXT NOT NULL DEFAULT '',
  junit TEXT,
  url TEXT,                         -- where to read more: GitHub's page for an imported job
  external_id TEXT,                 -- GitHub's id for an imported job, so a poll updates it
  created_at INTEGER NOT NULL
);
CREATE INDEX check_runs_by_ref ON check_runs (owner, repo, ref, id);
CREATE INDEX check_runs_by_sha ON check_runs (owner, repo, sha, external_id);

-- Per repo: where checks run (here, github or both; NULL is github for a GitHub mirror, none
-- otherwise), which ones a merge waits on (comma-separated names, or * for all), and whether
-- our own results go to GitHub as commit statuses.
CREATE TABLE check_settings (
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  run_where TEXT CHECK (run_where IN ('here', 'github', 'both')),
  required TEXT NOT NULL DEFAULT '',
  post_statuses INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, repo)
);

-- Shas that went up to GitHub, polled for their Actions results until they've all finished
-- or `until` passes.
CREATE TABLE check_watches (
  owner TEXT NOT NULL, repo TEXT NOT NULL, ref TEXT NOT NULL, sha TEXT NOT NULL,
  until INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, sha)
);
