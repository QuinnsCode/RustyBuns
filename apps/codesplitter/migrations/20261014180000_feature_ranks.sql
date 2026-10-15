-- Signed-in people rank codeSplitter's features in tiers (src/feature-ranks.ts), and leave a short
-- comment now and then. One tier per person per feature; a comment every 10 minutes at most.
CREATE TABLE feature_ranks (
  user TEXT NOT NULL,
  feature TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('S', 'A', 'B', 'C')),
  at INTEGER NOT NULL,
  PRIMARY KEY (user, feature)
);
CREATE TABLE feature_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX feature_comments_user ON feature_comments (user, at);
