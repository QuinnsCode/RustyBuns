-- QView3D's settings (src/settings.ts). Files stay in R2 (src/layout.ts); what an org and its products are set to lives here.
-- An org: which pages may embed it (origins), its admin keys' SHA-256s, the samples it has paid for, its eqosys studio,
-- and whether it is the public demo that keeps no files. Lists are JSON arrays, read back through the Org guard.
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  origins TEXT NOT NULL DEFAULT '[]',
  admins TEXT NOT NULL DEFAULT '[]',
  samples INTEGER NOT NULL DEFAULT 0,
  studio TEXT,
  read_only INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX orgs_studio ON orgs (studio);

-- A product: the Product guard's JSON (name, model, colours, print zones, default placement, a sample's GLB).
CREATE TABLE products (
  org TEXT NOT NULL,
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  updated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org, id)
);
