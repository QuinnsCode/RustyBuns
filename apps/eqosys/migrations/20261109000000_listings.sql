-- A studio's own game in the Library (listings.ts, LIBRARY.md): the fields of a row in APPS, its studio, and where its review stands.
-- `origins` and `returns` are JSON lists of URLs; `note` is the reviewer's words on a refusal; `at` is the last change (a pull's time
-- starts its saves' 30 days); `erased` is set once a pulled game's saves are gone. Times are ms since the epoch.
CREATE TABLE listings (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, genre TEXT NOT NULL,
  origins TEXT NOT NULL, returns TEXT, erase TEXT, blurb TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  made_at INTEGER NOT NULL, at INTEGER NOT NULL, erased INTEGER NOT NULL DEFAULT 0);
CREATE INDEX listings_state ON listings (state);
CREATE INDEX listings_studio ON listings (studio_id);
