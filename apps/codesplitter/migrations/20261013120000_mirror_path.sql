-- A folder mirror (src/folder-mirror.ts): the folder of upstream this repo mirrors, made its root
-- (apps/codesplitter out of a monorepo). NULL mirrors the whole repo, as before.
ALTER TABLE repos ADD COLUMN mirror_path TEXT;
