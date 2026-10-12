-- The dependency doctor (src/deps.ts): one row per repo whose owner opened it.
CREATE TABLE dep_watches (
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  every_hours INTEGER NOT NULL DEFAULT 24,
  max_level TEXT NOT NULL DEFAULT 'minor' CHECK (max_level IN ('patch', 'minor', 'major')),
  min_age_days INTEGER NOT NULL DEFAULT 3,
  ignore TEXT NOT NULL DEFAULT '',
  run_tests INTEGER NOT NULL DEFAULT 0,
  last_run INTEGER,
  last_report TEXT,
  running_since INTEGER,
  PRIMARY KEY (owner, repo)
);
