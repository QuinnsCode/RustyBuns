-- Saved code-mode programs (src/programs.ts): an agent names a working `execute` program and
-- reruns it later. One row per person per name; a program runs only as the token that asks.
CREATE TABLE programs (
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner, name)
);
