-- Rate limits (src/limits.ts): what each rule does when a caller goes over
-- (reject, log, or flag them for an admin), and a log of each time a caller
-- first went over in a window. The hourly cron drops entries older than a week.
ALTER TABLE limit_rules ADD COLUMN on_fail TEXT NOT NULL DEFAULT 'reject';
CREATE TABLE limit_events (
  id INTEGER PRIMARY KEY,
  rule TEXT NOT NULL,
  who TEXT NOT NULL,
  win INTEGER NOT NULL,          -- the window's start, ms
  action TEXT NOT NULL,          -- reject | log | flag
  at INTEGER NOT NULL
);
CREATE INDEX limit_events_at ON limit_events (at);
