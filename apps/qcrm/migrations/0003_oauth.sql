-- OAuth sign-in for MCP clients (src/oauth.ts). An access token is a row of api_keys (qo_…) that expires
-- and belongs to a grant: one person, one org, one app. Only hashes of codes and tokens are kept.
CREATE TABLE oauth_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE oauth_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL, client_name TEXT NOT NULL, redirect_uri TEXT NOT NULL,
  state TEXT, code_challenge TEXT NOT NULL, code_hash TEXT, org_id TEXT, expires_at INTEGER NOT NULL);
CREATE INDEX oauth_requests_code ON oauth_requests (code_hash);
CREATE TABLE oauth_grants (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, org_id TEXT NOT NULL, client_id TEXT NOT NULL, client_name TEXT NOT NULL,
  refresh_hash TEXT NOT NULL, prev_hash TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_used_at INTEGER);
CREATE INDEX oauth_grants_refresh ON oauth_grants (refresh_hash);
CREATE INDEX oauth_grants_prev ON oauth_grants (prev_hash);
CREATE INDEX oauth_grants_user ON oauth_grants (user_id);
ALTER TABLE api_keys ADD COLUMN grant_id TEXT;
ALTER TABLE api_keys ADD COLUMN expires_at INTEGER;
CREATE INDEX api_keys_grant ON api_keys (grant_id);
