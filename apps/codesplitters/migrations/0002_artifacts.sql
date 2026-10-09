-- Each excavation is backed by a Cloudflare Artifacts git repo. Cataloguing a
-- file pushes the repo's catalogued files there as one commit.
ALTER TABLE repos ADD COLUMN artifact TEXT;
ALTER TABLE repos ADD COLUMN artifact_remote TEXT;
