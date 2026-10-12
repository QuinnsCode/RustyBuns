-- Self-healing CI (src/heal.ts, #1015): a fix task works on an open branch itself, not on an
-- agent-run-<id> branch of its own, and nothing lands on main when it ends. `branch` names it;
-- null is a run started from the file page, as before. The attempts on a branch are counted by it.
ALTER TABLE agent_runs ADD COLUMN branch TEXT;
