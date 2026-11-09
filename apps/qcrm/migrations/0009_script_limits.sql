-- Script quotas and schedules (src/scripts.ts): how many runs an org gets a day, and a script the hourly cron runs.
ALTER TABLE orgs ADD COLUMN script_runs_per_day INTEGER NOT NULL DEFAULT 500;
ALTER TABLE scripts ADD COLUMN cron TEXT;
CREATE INDEX script_runs_org_started ON script_runs (org_id, started_at);
CREATE INDEX scripts_cron ON scripts (cron) WHERE cron IS NOT NULL;
