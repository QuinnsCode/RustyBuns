-- A new crew remote (src/archive.ts) owes the real text of private lines its
-- fork got blank (#341). 1 until that backfill lands; each commit tries again.
ALTER TABLE repos ADD COLUMN crew_backfill INTEGER;
