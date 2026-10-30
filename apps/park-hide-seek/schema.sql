-- What the iOS app keeps on the phone, in SQLite. Plain SQL with nothing SQLite-only in it, so D1 can run this file
-- as it is when saves start to follow a signed-in player.

-- The page's localStorage keys (phs.name, phs.look, phs.cam, phs.music), one row each; `look` holds the camper's Look as JSON.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per round played: where, which side, how long you lasted if you were caught, and what it scored.
CREATE TABLE IF NOT EXISTS rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  played_at   INTEGER NOT NULL,   -- ms since 1970
  zone        TEXT NOT NULL,
  n           INTEGER NOT NULL,   -- which round of the game, from 1
  role        TEXT NOT NULL CHECK (role IN ('camper', 'ranger')),
  caught_secs INTEGER,            -- null: not caught
  points      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rounds_by_time ON rounds (played_at DESC);
