-- Mervin learning (docs/mervin.md): one small event per merged file for repos that opted in (mervin_learning, above).
-- No contents, no diffs; paths are hashed.
ALTER TABLE mervin_learning ADD COLUMN since INTEGER NOT NULL DEFAULT 0;
CREATE TABLE mervin_events (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  ext TEXT NOT NULL,
  path_hash TEXT NOT NULL,
  outcome TEXT NOT NULL, -- settled | asked | wrong
  at INTEGER NOT NULL
);
CREATE INDEX mervin_events_repo ON mervin_events (owner, repo, at);
