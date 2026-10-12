-- A desktop repo's bare git is a remote for the owner's own tools (#464), and a push
-- there moves main without the files open here hearing of it (#773). git_seen is main's
-- tip as the app last knew it: after its own commits, a mirror sync, or landing a push.
-- Commits since then came from outside and land in open files as line edits. NULL until
-- the first commit or look, which takes the tip as it stands.
ALTER TABLE repos ADD COLUMN git_seen TEXT;
