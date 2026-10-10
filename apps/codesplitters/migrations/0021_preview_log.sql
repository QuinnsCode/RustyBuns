-- Preview deploys (src/preview.ts) are logged beside real ones, so a run
-- survives a restart. SQLite can't change a CHECK, so the table is rebuilt.
CREATE TABLE deploys_new (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  stage TEXT NOT NULL,
  by TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('button', 'commit', 'preview')),
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  commit_hash TEXT, url TEXT, note TEXT, out TEXT,
  at INTEGER NOT NULL, ms INTEGER
);
INSERT INTO deploys_new SELECT id, owner, repo, stage, by, trigger, status, commit_hash, url, note, out, at, ms FROM deploys;
DROP TABLE deploys;
ALTER TABLE deploys_new RENAME TO deploys;
CREATE INDEX deploys_by_repo ON deploys (owner, repo, at);
