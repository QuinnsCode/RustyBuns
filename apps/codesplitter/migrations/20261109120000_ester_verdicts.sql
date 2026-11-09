-- Ester's memory per repo (src/ester-checks.ts, #3923): what a person said a red check was. Her answer becomes a rule:
-- a check ruled flaky sorts as flaky on every branch until someone rules it fixed (fix) or no longer valid (stale).
-- The runs themselves are check_runs; this table only keeps the answers.
CREATE TABLE IF NOT EXISTS ester_verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT,
  note TEXT,
  by_user TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ester_verdicts_check ON ester_verdicts (owner, repo, name, id);
