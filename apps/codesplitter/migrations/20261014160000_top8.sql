-- A profile's Top 8 (JSON array of up to 7 handles after Mervin, who always holds slot 1).
-- NULL until the owner picks: the profile then shows the people they follow, newest first.
ALTER TABLE users ADD COLUMN top8 TEXT;
