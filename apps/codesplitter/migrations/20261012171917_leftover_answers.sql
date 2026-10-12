-- A merge routes what it leaves by each file's policy (src/branches.ts askLeftovers, #1012): a coding
-- agent answers a conflict in a file whose leftovers go to AI, on its own. Its checked answer is kept
-- here, keyed by the conflict it was for, so merging again asks nothing until that conflict changes.
CREATE TABLE leftover_answers (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  path TEXT NOT NULL,
  line TEXT NOT NULL,
  key TEXT NOT NULL,
  answer TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, branch, path, line)
);
