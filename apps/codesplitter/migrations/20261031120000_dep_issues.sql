-- The dependency doctor's own issue list (#3078): an update that broke and wasn't settled, filed for an agent to pick up later.
CREATE TABLE dep_issues (
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  id INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, from_v TEXT NOT NULL, to_v TEXT NOT NULL, path TEXT NOT NULL,
  out TEXT NOT NULL, tried TEXT NOT NULL, at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'open',
  PRIMARY KEY (owner, repo, id)
);
CREATE UNIQUE INDEX dep_issues_release ON dep_issues (owner, repo, path, name, to_v);
