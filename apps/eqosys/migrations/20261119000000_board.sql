-- Qollab posts and reactions (qollab/board.ts, QOLLAB.md "Posts and reactions"). A post is one short line a person puts up in an app;
-- a reaction is one icon one person pressed on one thing the app names (`ref`), a post being `post:<id>`. Counts are added up on read,
-- so taking a reaction back or deleting an account never leaves a count behind. Times are ms since the epoch.
CREATE TABLE posts (id TEXT PRIMARY KEY, app TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, text TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX posts_feed ON posts (app, kind, at);
CREATE INDEX posts_by ON posts (user_id, app, at);
CREATE TABLE reactions (app TEXT NOT NULL, ref TEXT NOT NULL, user_id TEXT NOT NULL, icon TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (app, ref, user_id, icon));
CREATE INDEX reactions_by ON reactions (user_id);
