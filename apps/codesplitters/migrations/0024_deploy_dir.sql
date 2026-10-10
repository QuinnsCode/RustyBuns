-- Deploy and preview (src/deploy.ts, src/preview.ts): the folder the app lives
-- in, for a monorepo. '' is the repo's root. Install, the config read and
-- rustybuns deploy/destroy run there.
ALTER TABLE deploy_settings ADD COLUMN dir TEXT NOT NULL DEFAULT '';
