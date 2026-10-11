-- Presence (src/file-do.ts): who has each file of main open right now, kept by
-- the file's DO as sockets come and go, so the code city (src/city.ts) can put
-- the people who are actually there on its streets. `at` is when they came in.
CREATE TABLE presence (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  path TEXT NOT NULL,
  who TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, path, who)
);
