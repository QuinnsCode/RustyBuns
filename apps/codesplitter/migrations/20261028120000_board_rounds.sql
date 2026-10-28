-- Opt-in record of Mervin's merge rounds (#1521): the repo says yes first, then each scored round is kept.
ALTER TABLE board_meta ADD COLUMN record_rounds INTEGER NOT NULL DEFAULT 0;
CREATE TABLE board_rounds (
  owner TEXT NOT NULL, repo TEXT NOT NULL, at INTEGER NOT NULL,
  main TEXT NOT NULL, round TEXT NOT NULL
);
CREATE INDEX board_rounds_repo ON board_rounds (owner, repo, at);
