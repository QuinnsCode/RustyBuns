-- Outgoing webhooks (src/hooks.ts): the owner's hooks per repo, and a log of every delivery.
CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL,          -- comma separated: commit,branch.opened,branch.merged,deploy.finished
  created_at INTEGER NOT NULL
);
CREATE INDEX webhooks_by_repo ON webhooks (owner, repo);
CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  hook TEXT NOT NULL,
  owner TEXT NOT NULL, repo TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER,               -- when a pending delivery is tried again
  code INTEGER, response TEXT,   -- the last attempt's HTTP status (0: no answer) and the start of its body
  at INTEGER NOT NULL
);
CREATE INDEX webhook_deliveries_by_hook ON webhook_deliveries (hook, at);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries (next_at) WHERE status = 'pending';
