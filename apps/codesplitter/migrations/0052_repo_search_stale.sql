-- Search across repos through one vector index (src/search.ts, #636). Each repo's row says how
-- many of its files the index doesn't have as committed yet; the hourly cron embeds those.
-- Every file indexed before this is one of them.
ALTER TABLE repo_search ADD COLUMN stale INTEGER NOT NULL DEFAULT 0;
UPDATE repo_search SET stale = files;
CREATE INDEX repo_search_stale ON repo_search (stale) WHERE stale > 0;
