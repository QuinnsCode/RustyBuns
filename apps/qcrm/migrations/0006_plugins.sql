-- Plugins (src/plugins.ts): one row per org per kind (twilio, plivo, form). `config` is JSON with its secrets
-- (auth tokens) AES-GCM encrypted under a key derived from the server secret. The inbound URL's token is kept
-- only as a SHA-256 hash (and its last four characters, to tell URLs apart); the URL is shown once.
CREATE TABLE plugins (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, kind TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}',
  token_hash TEXT NOT NULL UNIQUE, token_tail TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0, UNIQUE (org_id, kind));
