-- Bug reports, suggestions and errors a signed-in player sent from a game (reports.ts). One row each, so a person's rate limit
-- is a count and the owner can tell which account an issue came from. Times are ms since the epoch.
CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, app TEXT NOT NULL, at INTEGER NOT NULL, issue INTEGER);
CREATE INDEX reports_user ON reports (user_id, at);
