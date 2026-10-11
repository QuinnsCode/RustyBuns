-- Stamps (src/stamps.ts): a reaction on a line, not a pull request. Keyed by the
-- line's id, so a stamp stays on its line through edits the way a share does.
-- `author` is who last wrote the line when it was stamped, person or agent.
CREATE TABLE stamps (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  path TEXT NOT NULL,
  line TEXT NOT NULL,
  stamp TEXT NOT NULL,
  by TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, path, line, stamp, by)
);
CREATE INDEX stamps_by ON stamps (by, created_at);
CREATE INDEX stamps_author ON stamps (author, created_at);
