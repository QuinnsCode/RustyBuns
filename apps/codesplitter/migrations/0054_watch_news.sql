-- The supply-chain watch's news search (src/watch.ts, #699): opt-in, once a day, a
-- web search for compromised npm packages, summarised by Claude. Unverified, unlike
-- an OSV advisory, so it's kept apart from watch_mal and never makes a hit.
CREATE TABLE watch_news (
  url TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- JSON: the npm packages it names.
  packages TEXT NOT NULL,
  summary TEXT NOT NULL,
  published TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX watch_news_at ON watch_news (at);
