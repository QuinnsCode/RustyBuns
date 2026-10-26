-- A hosted agent's own Artifacts write token (src/run-token.ts, #2300): kept here so the run's
-- end, a Stop or the budget cap's cut can revoke it. Never sent to a browser: toRun copies `result`, not the row.
ALTER TABLE agent_runs ADD COLUMN token TEXT;
