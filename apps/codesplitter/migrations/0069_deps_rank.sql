-- The dependency doctor's package ranking (src/deps.ts, #862): the packages the
-- owner cares about most, highest first, comma-separated. In a clash, a higher
-- one keeps its target and a lower one gives way.
ALTER TABLE dep_watches ADD COLUMN rank TEXT;
