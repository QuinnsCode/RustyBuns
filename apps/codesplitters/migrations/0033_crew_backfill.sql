-- A new crew remote (src/archive.ts) owes the real text of private lines its
-- fork got blank (#341). 1 until that backfill lands; each commit tries again.
ALTER TABLE repos ADD COLUMN crew_backfill INTEGER;
-- Crew remotes made before the backfill existed owe it too; files they already have right are left out.
UPDATE repos SET crew_backfill = 1 WHERE crew_artifact IS NOT NULL;
