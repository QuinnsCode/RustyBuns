-- An account blocking another (qollab/board.ts, QOLLAB.md "Posts and reactions", Safety): account-wide, in every app. For now it
-- leaves the blocked person's posts out of the feeds the one who blocked them reads. Account delete takes both sides' rows.
CREATE TABLE blocks (user_id TEXT NOT NULL, blocked_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, blocked_id));
CREATE INDEX blocks_blocked ON blocks (blocked_id);
