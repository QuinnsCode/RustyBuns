-- OpenID clients (oauth.ts): the nonce an id_token must carry back, kept with the code it was asked with.
ALTER TABLE codes ADD COLUMN nonce TEXT;

-- Refresh tokens for native apps: a month long, one use each, only the hash kept.
CREATE TABLE refresh (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, app TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX refresh_user ON refresh (user_id);
