-- Mirrors (src/mirror.ts): a repo on the desktop kept in step with the real one it was cloned
-- from. upstream_commit is the last tip both sides agreed on.
ALTER TABLE repos ADD COLUMN mirror_url TEXT;          -- the remote it pulls from and pushes to; NULL for a plain fork
ALTER TABLE repos ADD COLUMN mirror_state TEXT;        -- ok | down | refused | clash | held
ALTER TABLE repos ADD COLUMN mirror_error TEXT;        -- what git said when it last didn't work
ALTER TABLE repos ADD COLUMN mirror_clash TEXT;        -- JSON: the files both sides changed, while it's a clash
ALTER TABLE repos ADD COLUMN mirror_down_since INTEGER;-- when upstream first stopped answering, cleared once it does
ALTER TABLE repos ADD COLUMN mirror_synced_at INTEGER; -- the last time the two agreed
ALTER TABLE repos ADD COLUMN mirror_next_at INTEGER;   -- when the cron next tries; backs off while it fails
ALTER TABLE repos ADD COLUMN mirror_fails INTEGER;     -- tries in a row that didn't work
