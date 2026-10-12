-- Real deploys (src/deploy.ts): the owner's settings per repo, and a log of every deploy.
CREATE TABLE deploy_settings (
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'prod',
  on_commit INTEGER NOT NULL DEFAULT 0,
  production INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, repo)
);
CREATE TABLE deploys (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  stage TEXT NOT NULL,
  by TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('button', 'commit')),
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  commit_hash TEXT, url TEXT, note TEXT, out TEXT,
  at INTEGER NOT NULL, ms INTEGER
);
CREATE INDEX deploys_by_repo ON deploys (owner, repo, at);
