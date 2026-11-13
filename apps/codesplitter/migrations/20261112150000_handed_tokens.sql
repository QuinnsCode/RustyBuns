-- Read tokens handed to someone other than the repo's owner (share links, the clone line on a repo's page).
-- Going private revokes the ones held by anyone outside the crew (share-tokens.ts). A row outlives its token by
-- nothing: each new one sweeps the expired.
CREATE TABLE IF NOT EXISTS handed_tokens (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  who TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS handed_tokens_repo ON handed_tokens (owner, repo);
