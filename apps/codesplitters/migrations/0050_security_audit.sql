-- The security audit log (src/audit.ts, #648): who made or revoked a token, changed a crew,
-- an invite, a repo's visibility, webhooks or deploy keys, or deleted a repo. Append-only:
-- rows are never changed, and go only with an account that's erased (privacy.ts). A deleted
-- repo's rows stay, so its owner can see who deleted it.
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT,                    -- the handle that did it
  via TEXT NOT NULL,             -- cookie | token | oauth | job | invite: what it was signed in with
  action TEXT NOT NULL,          -- token.create, repo.visibility, crew.remove, ...
  owner TEXT, repo TEXT,         -- the repo it was done in, if any
  target TEXT,                   -- what it was done to: a token's id, a handle, a hook's id, a provider
  detail TEXT,                   -- a word or two more: a label, the new visibility
  country TEXT                   -- the caller's country, as Cloudflare saw its IP
);
CREATE INDEX audit_repo ON audit (owner, repo, id);
CREATE INDEX audit_actor ON audit (actor, id);
CREATE TRIGGER audit_append_only BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;

-- CI tokens expire, like API tokens: 90 days unless made with days. Ones already out get
-- their 90 days, and at least 30 more from now, so none stops working the day this lands.
ALTER TABLE ci_tokens ADD COLUMN expires_at INTEGER;
UPDATE ci_tokens SET expires_at = MAX(created_at + 90 * 86400000, CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 30 * 86400000);

-- Invites keep the SHA-256 of their csi_ token, not the token (as api_tokens and ci_tokens do),
-- and an id to revoke or list them by. The secret is shown once, when it's made. Pending ones
-- can't be carried over (SQLite can't hash), so they're revoked: the owner makes them again.
-- Claimed ones stay, for who came in how, without their token.
CREATE TABLE invites_next (
  id TEXT PRIMARY KEY,
  hash TEXT UNIQUE,              -- SHA-256 of the csi_… token; NULL for one claimed before #648
  last4 TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  by TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_by TEXT,
  claimed_at INTEGER,
  door TEXT
);
INSERT INTO invites_next (id, hash, last4, owner, repo, by, kind, target, note, created_at, expires_at, claimed_by, claimed_at, door)
  SELECT lower(hex(randomblob(4))), NULL, substr(token, -4), owner, repo, by, kind, target, note, created_at, expires_at, claimed_by, claimed_at, door
  FROM invites WHERE claimed_by IS NOT NULL;
DROP TABLE invites;
ALTER TABLE invites_next RENAME TO invites;
CREATE INDEX invites_repo ON invites (owner, repo);
CREATE INDEX invites_target ON invites (target);
