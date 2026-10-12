-- A dug fork listens to its upstream (src/listen.ts, #870): upstream's newest
-- commit on the branch it was dug from, how many commits that is past
-- upstream_commit (null when GitHub wouldn't count them), and when it last asked.
ALTER TABLE repos ADD COLUMN upstream_tip TEXT;
ALTER TABLE repos ADD COLUMN upstream_behind INTEGER;
ALTER TABLE repos ADD COLUMN upstream_heard_at INTEGER;
