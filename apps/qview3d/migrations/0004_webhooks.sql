-- Webhooks (src/hooks.ts). A shop's URL that hears its events; the signing secret is sealed (AES-GCM under a key
-- made from UPLOAD_SECRET), since signing needs the secret itself, not a hash of it. `events` is a JSON array.
CREATE TABLE hooks (
  org TEXT NOT NULL,
  id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (org, id)
);

-- One send of one event to one hook. `body` is what was signed, so a retry sends the same bytes. A pending one is
-- tried again at `next` by the cron (worker.ts scheduled); each org keeps its last 20 that are done.
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  hook TEXT NOT NULL,
  event TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  code INTEGER,
  error TEXT,
  at INTEGER NOT NULL,
  next INTEGER
);
CREATE INDEX deliveries_org ON deliveries (org, at);
CREATE INDEX deliveries_due ON deliveries (status, next);

-- An order a store sent (POST /api/orgs/<org>/orders): its id at the store, and the OrderReply lines as JSON.
CREATE TABLE orders (
  org TEXT NOT NULL,
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (org, id)
);
