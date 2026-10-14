-- Rollbacks the watchdog Worker made (watchdog.ts, #1562): the Worker version it left and went back to, and
-- the deploy and branch that most likely shipped the bad one.
CREATE TABLE rollbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  from_version TEXT NOT NULL, to_version TEXT NOT NULL,
  deploy_id TEXT, commit_hash TEXT, branch TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX rollbacks_by_repo ON rollbacks (owner, repo, at);
