-- Qollab Events (qollab/events.ts, QOLLAB.md "Events"): one row an event, owned by the eqosys account that made it. `body` is its
-- EventDraft and `guests` its GuestList (@rustybuns/util/events, /guests), both JSON read back through their guards; `start` is
-- the draft's start time, kept beside it so "my events" sorts soonest first in one query. Times are ms since the epoch.
CREATE TABLE events (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, start INTEGER, body TEXT NOT NULL, guests TEXT NOT NULL, at INTEGER NOT NULL, edited INTEGER NOT NULL);
CREATE INDEX events_owner ON events (owner_id, start);
