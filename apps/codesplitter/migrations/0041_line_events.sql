-- The home feed (src/feed.ts): line events from every file on main, one row per
-- stretch of work. A file's Durable Object writes them as edits land, folding a
-- person's (or one agent run's) edits to that file into one row while they keep
-- going, so a burst of keystrokes is one event, not hundreds. No line text is
-- kept: who, where, how many lines and when. The feed checks read access at
-- query time, so a private repo's events reach only its crew. The hourly cron
-- drops events older than 30 days.
CREATE TABLE line_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL, repo TEXT NOT NULL, path TEXT NOT NULL,
  who TEXT NOT NULL,             -- @handle, or agent-<harness>
  run TEXT,                      -- an agent run's claim (run-<id>), when it had one
  sets INTEGER NOT NULL DEFAULT 0,
  inserts INTEGER NOT NULL DEFAULT 0,
  deletes INTEGER NOT NULL DEFAULT 0,
  lines INTEGER NOT NULL DEFAULT 0, -- distinct lines touched
  ids TEXT NOT NULL DEFAULT '[]',   -- JSON: the latest 200 of their ids, for line follows
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL
);
CREATE INDEX line_events_last ON line_events (last_at);
CREATE INDEX line_events_repo ON line_events (owner, repo, last_at);
CREATE INDEX line_events_who ON line_events (who, last_at);

-- Each person's latest feed digest, written by the coding agent they picked.
CREATE TABLE feed_digests (
  name TEXT PRIMARY KEY,
  harness TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  since INTEGER NOT NULL,        -- the events it covers: last_at after this
  through INTEGER NOT NULL,      -- and up to this
  text TEXT,
  error TEXT,
  at INTEGER NOT NULL
);
