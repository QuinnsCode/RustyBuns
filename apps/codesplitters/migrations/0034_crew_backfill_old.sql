-- Crew remotes made before the backfill (0033) existed owe it too; files they already have right are left out.
UPDATE repos SET crew_backfill = 1 WHERE crew_artifact IS NOT NULL;
