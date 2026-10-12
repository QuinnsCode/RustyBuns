-- Per repo: run only the commands in the check settings (#1010). On, a ref's codesplitter.ci and
-- package.json scripts are ignored, so a merged edit can't change what runs on a runner's machine.
ALTER TABLE check_settings ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
