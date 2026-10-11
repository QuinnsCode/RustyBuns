-- A branch knows when it last changed (src/checks.ts, #489): its file copies stamp it on every
-- edit, and a check run older than that is stale, so the merge gate waits for a fresh one.
ALTER TABLE branches ADD COLUMN changed_at INTEGER;

-- What a queued run of ours runs, picked when it was queued: a required check's command, or the
-- repo's own (codesplitters.ci, else package.json's scripts). Null: the runner's default.
ALTER TABLE check_runs ADD COLUMN command TEXT;
