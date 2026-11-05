-- @mentions in agent threads (src/mentions.ts, #3720): someone on the crew named in a thread, by a person or the agent,
-- has it in their inbox until they open the thread (seen_at).
CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_user TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  thread INTEGER NOT NULL,
  n INTEGER NOT NULL,
  by TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL,
  seen_at INTEGER,
  UNIQUE (to_user, owner, repo, thread, n)
);
CREATE INDEX IF NOT EXISTS mentions_inbox ON mentions (to_user, seen_at, at);
