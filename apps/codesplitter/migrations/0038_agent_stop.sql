-- Coding agents can be stopped, and told things while they work (src/agent-routes.ts).
-- `stopped` is a status of its own, and SQLite can't change a CHECK, so the table
-- is rebuilt. `notes` (JSON: [{text, at}]) go into the agent's next re-run's prompt.
CREATE TABLE agent_runs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL, repo TEXT NOT NULL, path TEXT NOT NULL,
  harness TEXT NOT NULL, task TEXT NOT NULL, model TEXT,
  agent TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed', 'stopped')),
  started INTEGER NOT NULL,
  picked INTEGER NOT NULL DEFAULT 0,
  log TEXT NOT NULL DEFAULT '[]',
  result TEXT,
  notes TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO agent_runs_new (id, owner, repo, path, harness, task, model, agent, status, started, picked, log, result)
  SELECT id, owner, repo, path, harness, task, model, agent, status, started, picked, log, result FROM agent_runs;
DROP TABLE agent_runs;
ALTER TABLE agent_runs_new RENAME TO agent_runs;
CREATE INDEX agent_runs_by_repo ON agent_runs (owner, repo, id);
