-- A repo that turned on Mervin's learning (docs/mervin.md): a row here lets one content-free outcome event per merge be emitted.
CREATE TABLE mervin_learning (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  -- 1: paths are hashed in the events (the default); 0: the repo says plain paths are fine.
  hash_paths INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (owner, repo)
);
