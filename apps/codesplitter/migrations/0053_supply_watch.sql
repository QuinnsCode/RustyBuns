-- The supply-chain watch (src/watch.ts, #614). Each agent platform's status page,
-- as last polled; every malicious-package advisory (OSV MAL-…) for npm seen since
-- the watch started; which repos depend on one; and where the watch has got to.
CREATE TABLE watch_status (
  name TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  indicator TEXT NOT NULL,
  description TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);
CREATE TABLE watch_mal (
  id TEXT NOT NULL, name TEXT NOT NULL,
  summary TEXT NOT NULL,
  -- JSON: the versions it names; null means every version.
  versions TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (id, name)
);
CREATE INDEX watch_mal_name ON watch_mal (name);
CREATE TABLE mal_hits (
  owner TEXT NOT NULL, repo TEXT NOT NULL, path TEXT NOT NULL,
  name TEXT NOT NULL, spec TEXT NOT NULL,
  id TEXT NOT NULL, summary TEXT NOT NULL,
  found_at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, path, name, id)
);
CREATE TABLE watch_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
