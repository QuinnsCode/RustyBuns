-- Which Artifacts namespace holds a repo's git (src/archive.ts artifactsFor): NULL is the default
-- (ARTIFACTS), "eu" is ARTIFACTS_EU. Set when the repo is made; a namespace's jurisdiction can't change.
ALTER TABLE repos ADD COLUMN namespace TEXT;
