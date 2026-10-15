-- The hidden games and rooms a person has found (src/finds.ts). Find all of them and the profile
-- wears a badge. One row per person per find.
CREATE TABLE finds (
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (name, key)
);
