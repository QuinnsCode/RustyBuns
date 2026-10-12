-- A pull-only mirror (#1009): 1 makes it one-way. Syncs fetch and merge upstream's
-- commits but never push, and the branch and tag push routes answer 409, so a mirror
-- kept for local CI can't write back upstream. NULL pushes as before.
ALTER TABLE repos ADD COLUMN mirror_pull_only INTEGER;
