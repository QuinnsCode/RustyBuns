-- Levels: famous repos imported into Artifacts. The list itself lives in
-- src/levels.ts; this only tracks where each import stands.
CREATE TABLE levels (
  slug TEXT PRIMARY KEY,
  status TEXT NOT NULL,          -- importing | ready | failed
  error TEXT,
  commit_hash TEXT,
  imported_at INTEGER
);

-- A git tree is named by its hash and never changes: keep every one we read.
CREATE TABLE tree_cache (hash TEXT PRIMARY KEY, entries TEXT NOT NULL);

-- Which branch a repo's artifact uses, and the level it was forked from.
ALTER TABLE repos ADD COLUMN branch TEXT;
ALTER TABLE repos ADD COLUMN level TEXT;
