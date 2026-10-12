-- Bring-your-own runners pull work (src/checks.ts, #534): a runner claims the oldest queued run
-- with POST .../checks/claim and says it's alive with each PUT. A claimed run that goes quiet
-- for too long goes back in the queue for someone else.
ALTER TABLE check_runs ADD COLUMN runner_label TEXT;   -- who claimed it, as the runner named itself
ALTER TABLE check_runs ADD COLUMN heartbeat_at INTEGER; -- the claimer's last word
CREATE INDEX check_runs_queued ON check_runs (owner, repo, status, id);

-- check_settings.required now holds JSON, [{name, paths?, command?}]: a check with paths is
-- required only on a branch that touches one of them. Old rows, comma-separated names, still read.
