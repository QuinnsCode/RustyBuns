-- Hosted deploys (src/deploy-keys.ts): a key per provider, not just Cloudflare's.
-- A Railway or Hetzner box target deploys with its own scoped token. The keys
-- stored so far are Cloudflare's.
CREATE TABLE deploy_keys_new (
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'cloudflare',   -- cloudflare | railway | hetzner
  sealed TEXT NOT NULL,           -- base64 of iv || ciphertext; {token, account_id?} inside
  last4 TEXT NOT NULL,
  set_by TEXT NOT NULL,
  set_at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, provider)
);
INSERT INTO deploy_keys_new (owner, repo, provider, sealed, last4, set_by, set_at)
  SELECT owner, repo, 'cloudflare', sealed, last4, set_by, set_at FROM deploy_keys;
DROP TABLE deploy_keys;
ALTER TABLE deploy_keys_new RENAME TO deploy_keys;
