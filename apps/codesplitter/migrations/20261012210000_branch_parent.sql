-- A branch opened on another branch (#1025): `parent` is the branch it's stacked on, and a file
-- copy's `source` is the branch whose copy it forked from (NULL: main's). When that branch merges,
-- its children's copies are moved onto main's (branches.ts restack) and their source goes back to NULL.
-- A beam of a stacked branch is a commit per branch, the bottom one first: `stack` lists them.
ALTER TABLE branches ADD COLUMN parent TEXT;
ALTER TABLE branch_files ADD COLUMN source TEXT;
ALTER TABLE beams ADD COLUMN stack TEXT;
