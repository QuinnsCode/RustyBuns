-- Per repo: a branch's checks count only if they saw main as it is now (#3314). On, a branch
-- merging into main makes every other open branch's runs stale (refChecks' `behind`), and when
-- checks run here, each is queued again at `<branch>@<time>`: main with the branch over it.
ALTER TABLE check_settings ADD COLUMN fresh_main INTEGER NOT NULL DEFAULT 0;
