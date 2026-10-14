-- Mervin learning (docs/mervin.md): per-repo opt-in, off by default, and one small event per merged file.
-- No contents, no diffs; paths are hashed.
CREATE TABLE mervin_learning (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  since INTEGER NOT NULL,
  PRIMARY KEY (owner, repo)
);
CREATE TABLE mervin_events (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  ext TEXT NOT NULL,
  path_hash TEXT NOT NULL,
  outcome TEXT NOT NULL, -- settled | asked | wrong
  at INTEGER NOT NULL
);
CREATE INDEX mervin_events_repo ON mervin_events (owner, repo, at);
