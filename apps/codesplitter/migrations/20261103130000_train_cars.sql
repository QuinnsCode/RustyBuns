-- Merge-train cars (#3323, train.ts): one speculative check run per merge-plan wave, on ref `train:<id>`.
-- branches: the wave's open branches, in merge order (JSON). parent: the red car this one is half of.
-- split: a red car already halved. blocks: the branch a red car came down to, to blame.
CREATE TABLE train_cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  branches TEXT NOT NULL,
  parent INTEGER,
  split INTEGER NOT NULL DEFAULT 0,
  blocks TEXT,
  by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX train_cars_repo ON train_cars (owner, repo, id);
