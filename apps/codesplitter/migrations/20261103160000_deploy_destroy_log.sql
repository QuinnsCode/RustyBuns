-- A stage's teardown (src/deploy.ts, #3372) is logged as its own trigger, so the
-- deploy log says "tore down" rather than "pressed deploy". SQLite can't change a
-- CHECK, so the table is rebuilt, keeping 0022's runner and key_last4.
CREATE TABLE deploys_new (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  stage TEXT NOT NULL,
  by TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('button', 'commit', 'preview', 'destroy')),
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  commit_hash TEXT, url TEXT, note TEXT, out TEXT,
  at INTEGER NOT NULL, ms INTEGER,
  runner TEXT NOT NULL DEFAULT 'desktop',
  key_last4 TEXT
);
INSERT INTO deploys_new SELECT id, owner, repo, stage, by, trigger, status, commit_hash, url, note, out, at, ms, runner, key_last4 FROM deploys;
DROP TABLE deploys;
ALTER TABLE deploys_new RENAME TO deploys;
CREATE INDEX deploys_by_repo ON deploys (owner, repo, at);
