-- What a branch waits for in the merge plan (#1162): the open branches it clashes with, as JSON, kept by
-- GET .../merge-plan (src/branches.ts). Its own checks wait till they've merged and it's taken main in.
ALTER TABLE branches ADD COLUMN waits_on TEXT;
