-- Files on rows (src/files.ts): the bytes live in R2 under <org>/<entity>/<row>/<id>; this is the index and the quota.
CREATE TABLE files (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL, name TEXT NOT NULL,
  type TEXT NOT NULL, size INTEGER NOT NULL, created_by TEXT, created_at INTEGER NOT NULL);
CREATE INDEX files_org_row ON files (org_id, entity, entity_id, created_at);
CREATE INDEX files_org_created ON files (org_id, created_at);
