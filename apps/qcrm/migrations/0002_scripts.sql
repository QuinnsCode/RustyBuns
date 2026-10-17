-- Scripts an org keeps and runs (src/scripts.ts): the code, and a row per run with its log.
CREATE TABLE scripts (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'js',
  created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, deleted_at INTEGER);
CREATE INDEX scripts_org_updated ON scripts (org_id, updated_at);
CREATE TABLE script_runs (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, script_id TEXT NOT NULL, actor_user_id TEXT, started_at INTEGER NOT NULL, finished_at INTEGER,
  status TEXT NOT NULL, log TEXT, result TEXT, calls INTEGER NOT NULL DEFAULT 0);
CREATE INDEX script_runs_org_script ON script_runs (org_id, script_id, started_at);
