-- A track remembers which lines it holds by id, so it follows the code as
-- lines are added or removed above it. The numbers stay as a fallback.
ALTER TABLE tracks ADD COLUMN from_id TEXT;
ALTER TABLE tracks ADD COLUMN to_id TEXT;
