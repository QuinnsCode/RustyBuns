-- A script may run itself: schedule is 'hourly' or 'daily' (NULL = by hand only). A scheduled run acts as
-- run_as, the manager who set it, and is skipped if they are no longer in the org. trigger says how a run began.
ALTER TABLE scripts ADD COLUMN schedule TEXT;
ALTER TABLE scripts ADD COLUMN run_as TEXT;
ALTER TABLE scripts ADD COLUMN last_scheduled_at INTEGER;
ALTER TABLE script_runs ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual';
