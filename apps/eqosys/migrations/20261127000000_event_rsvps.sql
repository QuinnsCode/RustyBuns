-- Qollab Events' RSVPs and tickets (qollab/rsvp.ts, QOLLAB.md "Events"). `event_rsvps` is one row a person coming, with their
-- answers (`plus` also gives them a second place); the cap is counted over it. `event_scans` is one row a ticket used at the
-- door (`seat` 1 the person, 2 their plus-one), so a ticket scans once.
CREATE TABLE event_rsvps (event_id TEXT NOT NULL, user_id TEXT NOT NULL, plus INTEGER NOT NULL, answers TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (event_id, user_id));
CREATE INDEX event_rsvps_user ON event_rsvps (user_id);
CREATE TABLE event_scans (event_id TEXT NOT NULL, user_id TEXT NOT NULL, seat INTEGER NOT NULL, at INTEGER NOT NULL, by_id TEXT NOT NULL, PRIMARY KEY (event_id, user_id, seat));
