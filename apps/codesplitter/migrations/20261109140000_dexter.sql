-- Dexter, opt in per repo (src/dexter.ts, #3923; the owner chose rows + cap). A repo's owner switches him on (dexter_repos);
-- switching off deletes that repo's rows in all of these. Each agent run the repo hosts reports its token use once, at its
-- end: one dexter_runs row and a dexter_tools row per tool it used. Never the transcript text.
-- Kept: runs and tools 30 days and the newest 5,000 runs per repo; the dexter_days rollup a year; a trim until decided, then 90 days.
-- The hourly cron sweeps them (sweepDexter).
CREATE TABLE IF NOT EXISTS dexter_repos (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  since INTEGER NOT NULL,
  PRIMARY KEY (owner, repo)
);
CREATE TABLE IF NOT EXISTS dexter_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  run TEXT NOT NULL,
  model TEXT NOT NULL,
  at INTEGER NOT NULL,
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  turns INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dexter_runs_repo ON dexter_runs (owner, repo, at);
CREATE TABLE IF NOT EXISTS dexter_tools (
  run_id INTEGER NOT NULL,
  tool TEXT NOT NULL,
  calls INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  worst INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dexter_tools_run ON dexter_tools (run_id);
CREATE TABLE IF NOT EXISTS dexter_days (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  day TEXT NOT NULL,
  tool TEXT NOT NULL,
  calls INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  runs INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, day, tool)
);
CREATE TABLE IF NOT EXISTS dexter_trims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  file TEXT NOT NULL,
  diff TEXT NOT NULL,
  saved INTEGER NOT NULL,
  status TEXT NOT NULL,
  at INTEGER NOT NULL,
  decided_by TEXT,
  decided_at INTEGER,
  branch TEXT
);
CREATE INDEX IF NOT EXISTS dexter_trims_repo ON dexter_trims (owner, repo, status);
