-- A binary file on a branch (#446): no copy of lines, just the git blob it came
-- in as (in the mirror's git) and its mode. Merging writes it into main's git;
-- pushing the branch upstream puts it in the tree.
ALTER TABLE branch_files ADD COLUMN blob TEXT;
ALTER TABLE branch_files ADD COLUMN mode TEXT;
