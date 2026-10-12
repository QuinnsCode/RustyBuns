-- Beams (src/beam.ts): a git branch's stack of commits cleaned into one commit and
-- handed to someone. The commit lives in the repo's git at refs/beams/<id>; this row
-- says whose it is, who it's for, what it's on top of, and what the clean-up dropped.
CREATE TABLE beams (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  branch TEXT NOT NULL,                     -- the git branch it was beamed from
  by TEXT NOT NULL,                         -- who beamed it
  to_user TEXT,                             -- whose inbox it's in, if anyone's
  title TEXT NOT NULL, message TEXT NOT NULL,
  onto TEXT NOT NULL,                       -- the commit it sits on: main's tip, or upstream's
  onto_label TEXT NOT NULL,                 -- "main" or "upstream <repo>@<branch>"
  sha TEXT NOT NULL,                        -- the one clean commit
  commits INTEGER NOT NULL,                 -- how many commits the branch's stack had
  files TEXT NOT NULL,                      -- JSON [{path, status}] it changes
  dropped TEXT NOT NULL,                    -- JSON [{path, why}] the clean-up left out
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'withdrawn')),
  created_at INTEGER NOT NULL
);
CREATE INDEX beams_repo ON beams (owner, repo, created_at);
CREATE INDEX beams_to ON beams (to_user, created_at);
