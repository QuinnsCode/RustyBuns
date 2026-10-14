-- Site-wide counters for the landing page: merges landed, and clashes Mervin settled without a card.
CREATE TABLE site_stats (
  name TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0
);
