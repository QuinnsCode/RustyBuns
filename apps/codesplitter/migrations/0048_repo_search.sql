-- Code search moves out of D1 into one Durable Object per repo (src/search.ts, #626).
-- D1 keeps a row per repo: its index's sizes, and that it has anything to search.
-- file_search stays until POST /api/admin/scale/search-move has emptied it; a later
-- migration drops it.
CREATE TABLE repo_search (
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  files INTEGER NOT NULL,
  text_bytes INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  big_path TEXT, big_bytes INTEGER NOT NULL, big_lines INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo)
);
CREATE INDEX repo_search_updated ON repo_search (updated_at);
