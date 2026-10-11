-- What the dependency doctor last told the owner about (src/deps.ts, #615): one key per
-- exposed advisory and per security fix on a branch, so a run only alerts on what's new.
ALTER TABLE dep_watches ADD COLUMN alerted TEXT;
