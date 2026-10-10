-- Branches: an agent's own copy of the files it touches, merged back into
-- main line by line. A branch's copy of a file is its own Durable Object;
-- this only says which files a branch has and which are merged.
CREATE TABLE branches (
  owner TEXT NOT NULL, repo TEXT NOT NULL, name TEXT NOT NULL,
  by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'merged')),
  created_at INTEGER NOT NULL,
  merged_by TEXT, merged_at INTEGER,
  PRIMARY KEY (owner, repo, name)
);
CREATE TABLE branch_files (
  owner TEXT NOT NULL, repo TEXT NOT NULL, branch TEXT NOT NULL, path TEXT NOT NULL,
  merged INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, repo, branch, path)
);
