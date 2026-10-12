-- Follows (src/follows.ts): who and what each person or agent keeps an eye on.
-- A follow is of a handle (a person or an agent), a repo, or a range of lines
-- in one file, kept by line id like a share, so it follows the lines as they move.
-- A private repo's follows only ever show to its crew: listFollows checks each
-- time, so losing the crew, or a repo going private, hides them.
CREATE TABLE follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'agent', 'repo', 'lines')),
  -- the handle; owner/repo; or owner/repo/path#firstId..lastId
  target TEXT NOT NULL,
  owner TEXT, repo TEXT, path TEXT,
  ids TEXT,                      -- lines: JSON, every line id in the range when followed
  from_line INTEGER, to_line INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (follower, kind, target)
);
CREATE INDEX follows_target ON follows (kind, target);
CREATE INDEX follows_repo ON follows (owner, repo);
