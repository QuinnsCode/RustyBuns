-- The live board (#1524): a row per open PR Mervin staged, and the board's own bookkeeping.
CREATE TABLE board_prs (
  owner TEXT NOT NULL, repo TEXT NOT NULL, pr INTEGER NOT NULL,
  row TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, pr)
);
CREATE TABLE board_meta (
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  main TEXT NOT NULL, hits TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo)
);
