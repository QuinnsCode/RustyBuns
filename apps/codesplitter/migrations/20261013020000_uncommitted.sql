-- Files on main with edits that no commit has taken yet (src/git-state.ts): marked when an edit lands
-- (line-events.ts), cleared when the file is committed, so the repo page can say "N files to commit".
CREATE TABLE uncommitted (
  owner TEXT NOT NULL, repo TEXT NOT NULL, path TEXT NOT NULL,
  since INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, path)
);
