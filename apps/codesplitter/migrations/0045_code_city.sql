-- Code city (src/city.ts): each person's public repos as a city. Its owner can
-- switch the public city off; it's on by default.
ALTER TABLE users ADD COLUMN city_public INTEGER NOT NULL DEFAULT 1;

-- A blob is named by its hash and never changes, so how many lines it has is
-- counted once and kept: a building's height for files that only live in git.
CREATE TABLE blob_lines (hash TEXT PRIMARY KEY, lines INTEGER NOT NULL);
