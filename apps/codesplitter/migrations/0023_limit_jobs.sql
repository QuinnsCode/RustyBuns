-- Rate limits (src/limits.ts): the "queue" action. A request over a queueable
-- rule's cap waits here, in line behind the caller's earlier ones, and is
-- replayed as them once their window has room: when the page polls
-- GET /api/jobs/:id, or on the five-minute cron. Finished jobs go after a week.
CREATE TABLE limit_jobs (
  id INTEGER PRIMARY KEY,
  rule TEXT NOT NULL,
  who TEXT NOT NULL,             -- who it counts as: @handle
  user TEXT NOT NULL,            -- who it runs as
  method TEXT NOT NULL,
  path TEXT NOT NULL,            -- with the query string
  body TEXT,
  state TEXT NOT NULL,           -- waiting | running | done
  at INTEGER NOT NULL,           -- queued, ms
  started INTEGER,
  status INTEGER,                -- the replayed response's
  result TEXT
);
CREATE INDEX limit_jobs_line ON limit_jobs (rule, who, state, id);
