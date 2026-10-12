-- The backrooms: each room's doors and wall lines, by commit and folder. A
-- commit never changes, so neither does its room.
CREATE TABLE walls_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL);
