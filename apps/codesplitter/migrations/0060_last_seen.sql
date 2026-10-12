-- The rev of each file a person last saw (#779), so the file page's "changed since
-- you were last here" bar follows the account, not just one browser (seen.ts). The
-- key is the client's own (owner/repo:branch:path); the newest 500 per person stay.
CREATE TABLE last_seen (
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  rev INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (name, key)
);
CREATE INDEX last_seen_at ON last_seen (name, at);
