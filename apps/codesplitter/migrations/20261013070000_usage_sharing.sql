-- "Help improve your git experience" (src/usage.ts): who agreed to share how their merge conflicts go.
-- NULL: not asked yet; 1: yes; 0: no. Only people who own a private repo are asked.
ALTER TABLE users ADD COLUMN share_usage INTEGER;

-- One row per conflict an agent was asked about, for opted-in owners only. No paths, no code, no repo
-- names: the file's extension, which round it was, who answered, and how it went. Kept 365 days by the hourly cron.
CREATE TABLE conflict_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,            -- the opted-in owner, so their export and delete find the rows
  at INTEGER NOT NULL,
  ext TEXT NOT NULL,             -- '.ts', 'lock', '' (none)
  round INTEGER NOT NULL,        -- the branch's conflict round (budget.ts conflictRound)
  who TEXT NOT NULL,             -- ask | handoff | downshift | escalate (a person's turn)
  harness TEXT,
  ok INTEGER,                    -- the agent's answer passed its checks; NULL when a person was asked
  tests TEXT                     -- passed | failed | not run
);
CREATE INDEX conflict_outcomes_at ON conflict_outcomes (at);
CREATE INDEX conflict_outcomes_name ON conflict_outcomes (name);
