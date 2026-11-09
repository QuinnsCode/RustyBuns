-- The bus's AI pass (src/pipeline-bus.ts, #3313): each change on main that took a seat on a bus lane with no command,
-- and one verdict per bus that left (keyed by main's commit it left at), so a retry reads the verdict instead of paying again.
CREATE TABLE IF NOT EXISTS bus_seats (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  lane TEXT NOT NULL,
  sha TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, lane, sha)
);

CREATE TABLE IF NOT EXISTS bus_passes (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  lane TEXT NOT NULL,
  sha TEXT NOT NULL,
  say TEXT NOT NULL,
  by TEXT NOT NULL DEFAULT '',
  reason TEXT,
  aboard INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, lane, sha)
);
