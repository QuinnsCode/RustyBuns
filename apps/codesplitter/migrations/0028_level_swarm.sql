-- A big level dug up by a swarm of queue consumers (src/swarm.ts): how many
-- parts it was split into, and each part's files as it lands, until the last
-- one in writes the level's trees.
ALTER TABLE levels ADD COLUMN parts INTEGER;
CREATE TABLE level_parts (
  slug TEXT NOT NULL,
  sha TEXT NOT NULL,
  n INTEGER NOT NULL,      -- the chunk it filled; -1 holds the files nobody stores
  files TEXT NOT NULL,     -- JSON [path, entry][]
  PRIMARY KEY (slug, sha, n)
);
