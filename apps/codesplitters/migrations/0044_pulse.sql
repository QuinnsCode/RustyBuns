-- Pulse (src/pulse.ts): lines landed per hour over the last week, read from the
-- feed's line_events. Each person may turn their public pulse off (PUT /api/me {pulse: false}).
ALTER TABLE users ADD COLUMN pulse INTEGER NOT NULL DEFAULT 1;
