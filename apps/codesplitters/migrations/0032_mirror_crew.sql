-- Mirrors (src/mirror.ts) of repos with private lines: when the owner says so, the crew's copy
-- (real text) is the one kept in step with upstream, instead of being held back.
ALTER TABLE repos ADD COLUMN mirror_push_crew INTEGER; -- 1: push the crew's copy upstream; NULL: held
