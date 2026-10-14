-- A queued request made with an API token remembers which one (src/limits.ts): the job is dropped, not run, if the token is gone by its turn.
ALTER TABLE limit_jobs ADD COLUMN token TEXT;
