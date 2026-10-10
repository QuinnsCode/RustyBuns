-- A level too big for Artifacts lives in R2 as chunks (src/chunks.ts): its
-- trees in tree_cache, its tip's message here. store is 'r2' for those, NULL
-- for a level in Artifacts.
ALTER TABLE levels ADD COLUMN store TEXT;
ALTER TABLE levels ADD COLUMN commit_message TEXT;
