-- Rate limits (src/limits.ts). The rules live in code; an admin's changes to
-- one are kept here. Hits are counted per rule, per caller, per fixed window,
-- and the hourly cron clears out windows that have passed.
CREATE TABLE limit_rules (
  name TEXT PRIMARY KEY,
  max INTEGER NOT NULL,
  window_s INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE limit_hits (
  rule TEXT NOT NULL,
  who TEXT NOT NULL,
  win INTEGER NOT NULL,          -- the window's start, ms
  count INTEGER NOT NULL,
  PRIMARY KEY (rule, who, win)
);
