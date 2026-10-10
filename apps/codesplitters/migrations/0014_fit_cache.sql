-- Rusty Buns fit (src/fit.ts): each repo's last verdict, per folder checked
-- ('' is the root), and the commit it was read at. Replaced when main moves.
CREATE TABLE fit_cache (
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  dir TEXT NOT NULL DEFAULT '',
  commit_hash TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (owner, repo, dir)
);
