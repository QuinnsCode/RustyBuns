-- Fresh starts (src/fresh.ts): a repo's git moved to a new Artifact that holds
-- only its current files, when the old one nears Artifacts' 1 GB a repo. Every
-- line's history stays in the files' Durable Objects either way.
ALTER TABLE repos ADD COLUMN git_bytes INTEGER;   -- what we know is in its git: measured by a fresh start, plus each push since
ALTER TABLE repos ADD COLUMN git_error TEXT;      -- the last push that didn't land, cleared by the next one that does
ALTER TABLE repos ADD COLUMN old_artifacts TEXT;  -- JSON: Artifacts it moved off, kept with their history until the owner deletes them
-- Catalogued, but the push didn't land (or git was moving); the next push that lands carries them.
CREATE TABLE git_pending (
  owner TEXT NOT NULL, repo TEXT NOT NULL, path TEXT NOT NULL,
  PRIMARY KEY (owner, repo, path)
);
CREATE TABLE fresh_starts (
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  state TEXT NOT NULL,            -- walking | copying | done | failed
  artifact TEXT NOT NULL,         -- the new Artifact
  remote TEXT NOT NULL,
  previous TEXT NOT NULL,         -- the Artifact it moves off, kept with its history
  tip TEXT NOT NULL,              -- the commit whose files it copies
  tree TEXT NOT NULL,             -- and that commit's tree, which the new root commit reuses
  queue TEXT,                     -- walking: trees still to read (JSON)
  stage TEXT,                     -- copying: the last staging commit pushed
  done INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,   -- the files' bytes, uncompressed
  error TEXT,
  lease INTEGER,                  -- a step running since then; one at a time
  started_at INTEGER NOT NULL, finished_at INTEGER,
  PRIMARY KEY (owner, repo)
);
-- Every object the fresh start copies, in an order where each tree comes after what's in it.
CREATE TABLE fresh_objects (
  owner TEXT NOT NULL, repo TEXT NOT NULL, seq INTEGER NOT NULL,
  hash TEXT NOT NULL, type TEXT NOT NULL,
  PRIMARY KEY (owner, repo, seq)
);
