-- A report from a studio's own game (listings.ts) stays in eqosys for its studio to read, instead of becoming an issue on this
-- repo (reports.ts): what kind it was, its title, and the player's text with the page, build and detail they sent, as JSON. A row
-- filed as an issue leaves them null, the way it always has.
ALTER TABLE reports ADD COLUMN kind TEXT;
ALTER TABLE reports ADD COLUMN title TEXT;
ALTER TABLE reports ADD COLUMN body TEXT;
CREATE INDEX reports_app ON reports (app, at);
