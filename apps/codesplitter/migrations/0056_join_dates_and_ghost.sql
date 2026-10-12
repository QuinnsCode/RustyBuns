-- When each person arrived (#512). Insights' "Joined" was the earliest step in
-- user_steps, so anyone here before #509 who hasn't made anything since showed "—".
-- users.created_at is set from now on; an account's Better Auth "createdAt" fills it
-- in for those already here (ISO text on D1, a number elsewhere, as sweepSessions reads it).
ALTER TABLE users ADD COLUMN created_at INTEGER;
UPDATE users SET created_at = (
  SELECT CASE typeof(u."createdAt")
    WHEN 'text' THEN CAST(ROUND((julianday(u."createdAt") - 2440587.5) * 86400000) AS INTEGER)
    ELSE u."createdAt" END
  FROM "user" u WHERE u.id = users.auth_id
) WHERE auth_id IS NOT NULL;
INSERT INTO user_steps (name, step, first_at, last_at, n)
  SELECT name, 'joined', created_at, created_at, 1 FROM users WHERE created_at IS NOT NULL
  ON CONFLICT (name, step) DO UPDATE SET first_at = MIN(first_at, excluded.first_at);

-- A deleted account's handle, and the repos it may still be named in (#514), until an
-- admin, or the delete itself when the person asks, swaps it for @ghost there (privacy.ts).
-- Once scrubbed, the list goes.
CREATE TABLE retired_handles (
  handle TEXT PRIMARY KEY,
  -- JSON: [[owner, repo], ...]
  repos TEXT NOT NULL DEFAULT '[]',
  retired_at INTEGER NOT NULL,
  scrubbed_at INTEGER
);
-- @ghost stands in for them, so no one signs in as it.
INSERT OR REPLACE INTO handle_grants (handle, email) VALUES ('ghost', 'retired:ghost');
