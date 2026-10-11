-- Invites (src/invites.ts): a pending place in a repo's crew, behind a link. The
-- owner invites a handle, an email or nobody in particular (a bare link); whoever
-- opens /invite/<token> sees the repo and comes in as a person (signed in, with a
-- handle) or as an agent (a handle and API token made for it there and then).
-- Claimed, the row stays, saying who it became; revoked, it's gone.
CREATE TABLE invites (
  token TEXT PRIMARY KEY,        -- csi_…, the link's secret
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  by TEXT NOT NULL,              -- who invited
  kind TEXT NOT NULL,            -- handle | email | link
  target TEXT,                   -- the handle or email; null for a bare link
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_by TEXT,               -- the handle it resolved to
  claimed_at INTEGER,
  door TEXT                      -- person | agent
);
CREATE INDEX invites_repo ON invites (owner, repo);
CREATE INDEX invites_target ON invites (target);
