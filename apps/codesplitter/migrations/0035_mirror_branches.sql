-- Mirrors (src/mirror.ts) sync branches too: the upstream git branch a codeSplitters branch
-- was opened from or pushed to. NULL: none yet (a push goes to one of the branch's own name).
ALTER TABLE branches ADD COLUMN upstream_ref TEXT;
