-- A post the app's studio hid (qollab/board.ts): it stays in the table (the studio can bring it back, the author's privacy export
-- still lists it) and is left out of every feed.
ALTER TABLE posts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
