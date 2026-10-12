-- Shared line ranges: a live link to some lines of one file, readable by
-- anyone with the link even when the repo is private. `ids` is every line id
-- in the range when it was shared, so the range follows the lines as the file
-- changes around them.
CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  path TEXT NOT NULL,
  ids TEXT NOT NULL,
  by TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX shares_file ON shares (owner, repo, path);
