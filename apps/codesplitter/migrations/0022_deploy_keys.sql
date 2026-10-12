-- Hosted deploys (src/deploy-keys.ts): each repo's write-only deploy key, sealed
-- with AES-GCM under DEPLOY_SECRETS_KEY, and which runner each deploy used.
CREATE TABLE deploy_keys (
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  sealed TEXT NOT NULL,           -- base64 of iv || ciphertext; {token, account_id} inside
  last4 TEXT NOT NULL,
  set_by TEXT NOT NULL,
  set_at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo)
);
ALTER TABLE deploys ADD COLUMN runner TEXT NOT NULL DEFAULT 'desktop';
ALTER TABLE deploys ADD COLUMN key_last4 TEXT;
