-- Personal API tokens (src/tokens.ts): a script or an agent outside the browser
-- acts as `name` with `Authorization: Bearer cst_…`. Only the secret's SHA-256 is
-- kept; the secret itself is shown once, when it's made.
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,            -- whose: @handle
  label TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,     -- hex SHA-256 of the secret
  last4 TEXT NOT NULL,
  scope TEXT NOT NULL,           -- read | write
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX api_tokens_name ON api_tokens (name);
