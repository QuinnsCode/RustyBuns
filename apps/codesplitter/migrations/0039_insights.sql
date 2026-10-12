-- Insights (src/insights.ts): who's really using the site, for admins.
-- `traffic` counts requests from the internet per day, per caller, by whether
-- they look like a person in a browser, an agent (an API token, MCP, a script)
-- or a crawler. A caller is their @handle, or, signed out, a salted hash of
-- their IP that changes every day. The hourly cron drops days older than 30.
CREATE TABLE traffic (
  day INTEGER NOT NULL,          -- the UTC day's start, ms
  who TEXT NOT NULL,             -- @handle, or ip:<hash>
  kind TEXT NOT NULL,            -- person | agent | bot
  via TEXT NOT NULL,             -- browser | token | mcp | script | headless | crawler
  hits INTEGER NOT NULL,
  errors INTEGER NOT NULL,       -- answered 5xx
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  ua TEXT,                       -- the last user agent, cut short
  PRIMARY KEY (day, who, kind, via)
);
CREATE INDEX traffic_last ON traffic (last_at);

-- How far each person has got: the first and last time they did each step of
-- the way in (made a repo, wrote code, committed, shared, ran an agent, deployed).
CREATE TABLE user_steps (
  name TEXT NOT NULL,
  step TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (name, step)
);

-- What's already here counts.
INSERT OR IGNORE INTO user_steps (name, step, first_at, last_at, n)
  SELECT owner, 'repo', MIN(created_at), MAX(created_at), COUNT(*) FROM repos GROUP BY owner;
INSERT OR IGNORE INTO user_steps (name, step, first_at, last_at, n)
  SELECT by, 'code', MIN(created_at), MAX(created_at), COUNT(*) FROM branches GROUP BY by;
INSERT OR IGNORE INTO user_steps (name, step, first_at, last_at, n)
  SELECT by, 'share', MIN(created_at), MAX(created_at), COUNT(*) FROM shares GROUP BY by;
INSERT OR IGNORE INTO user_steps (name, step, first_at, last_at, n)
  SELECT by, 'deploy', MIN(at), MAX(at), COUNT(*) FROM deploys GROUP BY by;
