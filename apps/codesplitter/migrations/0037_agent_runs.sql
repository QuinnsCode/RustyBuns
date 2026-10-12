-- Coding agents' runs (src/agent-routes.ts). They lived in the Worker isolate's
-- memory, but on Cloudflare the next poll lands on another isolate, so the phone
-- page missed hosted runs. A hosted run is picked up off the JOBS queue; `picked`
-- marks that it began, so a retry after the consumer was cut off fails it rather
-- than running the agent twice.
CREATE TABLE agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL, repo TEXT NOT NULL, path TEXT NOT NULL,
  harness TEXT NOT NULL, task TEXT NOT NULL, model TEXT,
  agent TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  started INTEGER NOT NULL,
  picked INTEGER NOT NULL DEFAULT 0,
  log TEXT NOT NULL DEFAULT '[]',   -- JSON: the log's last lines
  result TEXT                       -- JSON: applied, rev, runs, conflicts, github, output, error
);
CREATE INDEX agent_runs_by_repo ON agent_runs (owner, repo, id);
