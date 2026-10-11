-- A branch can delete a file (branches.ts): its row says so, and merging it
-- deletes the file from main. Pushed upstream, the file goes from the git branch.
ALTER TABLE branch_files ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
