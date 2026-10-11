-- A push to a desktop repo's git (#773) that clashes with edits here not committed yet
-- (#788): {path: the pushed commit}. The file's commit waits until the owner keeps the
-- edits here or takes the pushed lines. NULL when there's none.
ALTER TABLE repos ADD COLUMN git_clash TEXT;
