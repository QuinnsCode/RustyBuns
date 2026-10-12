-- A GitHub repo a visitor digs up is temporary: it expires a day later, and the
-- oldest goes first once too many are live. Admins' digs keep (NULL).
ALTER TABLE repos ADD COLUMN expires_at INTEGER;
CREATE INDEX repos_expires ON repos (expires_at) WHERE expires_at IS NOT NULL;

-- Handles of five characters or fewer aren't made at signup; an admin gives
-- them out, by email, and the account with that email gets it on first sign-in.
CREATE TABLE handle_grants (
  handle TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
);
