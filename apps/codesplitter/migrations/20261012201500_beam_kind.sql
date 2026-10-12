-- A beam's branch is a git branch or, since #918, a codeSplitter branch (src/beam.ts linesStack):
-- its files as they are now, laid on main's tip as one commit.
ALTER TABLE beams ADD COLUMN kind TEXT NOT NULL DEFAULT 'git' CHECK (kind IN ('git', 'codesplitter'));
