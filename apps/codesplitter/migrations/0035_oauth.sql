-- OAuth sign-in (src/oauth.ts): an app outside the browser (Executor, an MCP client)
-- opens a codeSplitters page, you say yes, and it gets tokens without you copying one.
-- Only hashes of codes and refresh tokens are kept.

-- Apps that registered themselves (POST /api/oauth/register). An app on your own
-- computer (a loopback redirect) needn't register: its client_id is just a name.
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,           -- csc_…
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,   -- JSON array
  created_at INTEGER NOT NULL
);

-- A sign-in in progress: made when the consent page shows, given a code when you say
-- yes, and gone once the app swaps the code for tokens (or after 10 minutes).
CREATE TABLE oauth_requests (
  id TEXT PRIMARY KEY,           -- the consent form's, never sent to the app
  name TEXT NOT NULL,            -- whose: @handle
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state TEXT,
  code_challenge TEXT NOT NULL,  -- PKCE, S256
  scope TEXT,                    -- read | write, once you've said yes
  code_hash TEXT UNIQUE,
  expires_at INTEGER NOT NULL
);

-- An app you've said yes to: its refresh token, rotated on every use. Revoking it on
-- your profile page deletes its access tokens (api_tokens.grant_id) too.
CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  scope TEXT NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  prev_hash TEXT,                -- the one before: shown again, it was stolen, and the grant goes
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX oauth_grants_name ON oauth_grants (name);

-- An OAuth access token is an api_tokens row with its grant: an hour long, never listed with yours.
ALTER TABLE api_tokens ADD COLUMN grant_id TEXT;
CREATE INDEX api_tokens_grant ON api_tokens (grant_id);
