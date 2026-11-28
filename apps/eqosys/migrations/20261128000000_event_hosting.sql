-- Qollab Events past the guest list's 500 (#6544): a plain guest's RSVP row is their place at the event, so it carries their
-- name; the JSON list keeps the crew. The index lets the cap's count read the index alone. `event_pictures` is one picture an
-- event (qollab/events.ts PICTURE_MAX bytes), sniffed as the type kept with it.
ALTER TABLE event_rsvps ADD COLUMN name TEXT NOT NULL DEFAULT '';
CREATE INDEX event_rsvps_places ON event_rsvps (event_id, plus, user_id);
CREATE TABLE event_pictures (event_id TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, at INTEGER NOT NULL);
