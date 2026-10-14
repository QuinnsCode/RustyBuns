-- "Protect main" (#1426): crew edit on branches only, agent batches wait for a person, nobody merges their own branch.
CREATE TABLE protect_main (
  owner TEXT NOT NULL, repo TEXT NOT NULL, on_ INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, repo)
);
