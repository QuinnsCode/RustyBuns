-- Cuts: some lines of a repo, and the imports they use, cut out as a tiny
-- repo you can run, share and merge back. A cut is a branch (`branch`) whose
-- files start as just those lines, ids and revs intact; `paths` is its files
-- (JSON), `run` its last test run (JSON: marks by line id, output, counts).
CREATE TABLE cuts (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  paths TEXT NOT NULL,
  by TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  run TEXT
);
CREATE INDEX cuts_repo ON cuts (owner, repo);
