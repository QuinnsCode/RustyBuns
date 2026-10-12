-- Who is named in each repo's files (#748): on a line, an op or a commit, kept by
-- the file DOs as lines land (file-do.ts), main's copy and each branch's. A line
-- copied in with its author (a cut, a merge into someone else's repo) lands here
-- too, so the @ghost scrub (privacy.ts) finds repos the handle never touched itself.
CREATE TABLE authors (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  handle TEXT NOT NULL,
  PRIMARY KEY (owner, repo, handle)
);
CREATE INDEX authors_handle ON authors (handle);
-- What's known already: the edits still in the feed. Each file DO adds the rest
-- of its lines' authors the first time it wakes after this.
INSERT OR IGNORE INTO authors (owner, repo, handle) SELECT DISTINCT owner, repo, who FROM line_events;
