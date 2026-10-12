-- The crew's git remote (src/archive.ts): a second Artifacts repo,
-- "<artifact>--crew", that commits push with private lines' real text in
-- them. Made when a line is first marked private; previews and deploys clone
-- it. The repo's own remote keeps getting those lines blank.
ALTER TABLE repos ADD COLUMN crew_artifact TEXT;
ALTER TABLE repos ADD COLUMN crew_remote TEXT;
